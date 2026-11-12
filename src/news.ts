// --- News injection ----------------------------------------------------------
// Lets the user pull the latest headlines from a configurable list of news
// sources (RSS/Atom feeds) and inject them into the chat as a prompt for the
// agent to analyze. The source list is editable from the News tab and stored
// in workspaceState.

import * as https from 'https';
import { URL } from 'url';

export interface NewsSource {
    id: string;
    name: string;
    url: string;
}

export interface FeedItem {
    title: string;
    link: string;
    date: string;
}

export interface FeedResult {
    source: NewsSource;
    items: FeedItem[];
    error?: string;
}

/** The default source list. Users can edit all of these in the News tab. */
export const DEFAULT_NEWS_SOURCES: NewsSource[] = [
    { id: 'green-left', name: 'Green Left', url: 'https://www.greenleft.org.au/rss.xml' },
    { id: 'geopolitical-economy', name: 'Geopolitical Economy Report', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCwlvSJdcMc7iGdR-aducSog' },
    { id: 'red-ant', name: 'Red Ant', url: 'https://red-ant.org/feed/' },
    { id: 'cgtn', name: 'CGTN', url: 'https://www.cgtn.com/subscribe/rss/section/world.xml' },
    { id: 'bloomberg', name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss' },
    { id: 'breakthrough-news', name: 'Breakthrough News', url: 'https://www.breakthroughnews.org/feed/' },
    { id: 'greenwald', name: 'Glenn Greenwald', url: 'https://greenwald.substack.com/feed' },
    { id: 'jimmy-dore', name: 'Jimmy Dore', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC3M7l8ved_rYQ45AVzS0RGA' },
    { id: 'mr-online', name: 'MR Online', url: 'https://mronline.org/feed/' },
];

export function makeSourceId(): string {
    return `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeSources(raw: unknown): NewsSource[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: NewsSource[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Partial<NewsSource>;
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
        const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
        if (!name || !url) continue;
        const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : makeSourceId();
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({ id, name, url });
    }
    return result;
}

function decodeEntities(text: string): string {
    return text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        .trim();
}

/** Extract feed items from an RSS or Atom document. No XML parser dependency. */
export function extractFeedItems(xml: string, limit = 4): FeedItem[] {
    const blocks: string[] = [];
    const itemRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
    let match: RegExpExecArray | null;
    while ((match = itemRe.exec(xml)) !== null && blocks.length < limit) {
        blocks.push(match[1]);
    }

    const items: FeedItem[] = [];
    for (const block of blocks) {
        const title = decodeEntities((/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, ''));
        if (!title) continue;

        // RSS uses <link>text</link>; Atom uses <link href="...">.
        let link = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? '';
        link = link.trim();
        if (!link || /^https?:\/\//i.test(link) === false) {
            const href = /<link[^>]*href="([^"]+)"/.exec(block)?.[1] ?? '';
            if (href) link = href.trim();
        }

        const date = decodeEntities(
            (/<(?:pubDate|published|updated)(?:\s[^>]*)?>([\s\S]*?)<\/(?:pubDate|published|updated)>/.exec(block)?.[1] ?? ''),
        );

        items.push({ title, link, date });
    }
    return items;
}

function fetchText(url: string, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            reject(new Error('Invalid URL'));
            return;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            reject(new Error('Unsupported protocol'));
            return;
        }
        const lib = parsed.protocol === 'https:' ? https : require('http');
        const request = lib.get(
            parsed,
            { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CodingAgent/0.3; +rss)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } },
            (response: { statusCode?: number; headers: Record<string, unknown>; on: (event: string, cb: (chunk?: Buffer | string) => void) => void }) => {
                // Follow a single redirect if present.
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
                    const location = response.headers['location'];
                    if (typeof location === 'string') {
                        fetchText(location, timeoutMs).then(resolve, reject);
                        return;
                    }
                }
                if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 400) {
                    reject(new Error(`HTTP ${response.statusCode ?? 'unknown'}`));
                    return;
                }
                let body = '';
                response.on('data', (chunk?: Buffer | string) => { body += chunk ? chunk.toString() : ''; });
                response.on('end', () => resolve(body));
                response.on('error', reject);
            },
        );
        request.on('error', reject);
        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error('The request timed out — try again or check the feed URL.'));
        });
    });
}

/** Fetch every source in parallel; each failing source degrades to an error note. */
export async function fetchNews(sources: NewsSource[], perSource = 4): Promise<FeedResult[]> {
    return Promise.all(
        sources.map(async (source): Promise<FeedResult> => {
            try {
                const xml = await fetchText(source.url);
                const items = extractFeedItems(xml, perSource);
                if (items.length === 0) return { source, items: [], error: 'No items found in feed (check the feed URL in the News tab).' };
                return { source, items };
            } catch (error) {
                return { source, items: [], error: error instanceof Error ? error.message : 'Unknown feed error' };
            }
        }),
    );
}

/** Build the injected prompt text from fetched results. */
export function buildNewsDigest(results: FeedResult[], fetchedAt: Date): string {
    const lines: string[] = [`Latest news stories from my sources (fetched ${fetchedAt.toISOString()}):`, ''];
    for (const result of results) {
        lines.push(`## ${result.source.name}`);
        if (result.error) {
            lines.push(`(feed unavailable: ${result.error})`);
        } else {
            for (const item of result.items) {
                const dateSuffix = item.date ? ` (${item.date})` : '';
                lines.push(`- ${item.title}${dateSuffix} — ${item.link}`);
            }
        }
        lines.push('');
    }
    lines.push('Please summarize the key stories above, grouped by source, with links.');
    return lines.join('\n');
}
