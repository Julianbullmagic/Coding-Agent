import * as assert from 'assert';
import {
    DEFAULT_NEWS_SOURCES,
    extractFeedItems,
    sanitizeSources,
    makeSourceId,
    buildNewsDigest,
} from '../src/news';

describe('news', () => {
    it('has default sources with unique ids, names and urls', () => {
        const ids = new Set(DEFAULT_NEWS_SOURCES.map((s) => s.id));
        assert.strictEqual(ids.size, DEFAULT_NEWS_SOURCES.length);
        for (const source of DEFAULT_NEWS_SOURCES) {
            assert.ok(source.name.length > 0);
            assert.ok(/^https?:\/\//.test(source.url));
        }
    });

    it('extracts RSS items with titles and links', () => {
        const xml = `<?xml version="1.0"?><rss><channel>
            <item><title><![CDATA[First story &amp; more]]></title><link>https://example.com/a</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate></item>
            <item><title>Second story</title><link>https://example.com/b</link></item>
        </channel></rss>`;
        const items = extractFeedItems(xml, 5);
        assert.strictEqual(items.length, 2);
        assert.strictEqual(items[0].title, 'First story & more');
        assert.strictEqual(items[0].link, 'https://example.com/a');
        assert.ok(items[0].date.includes('2026'));
    });

    it('extracts Atom entries with href links', () => {
        const xml = `<feed><entry>
            <title>Atom entry</title>
            <link href="https://example.com/atom-post"/>
            <updated>2026-01-02T03:04:05Z</updated>
        </entry></feed>`;
        const items = extractFeedItems(xml, 5);
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].title, 'Atom entry');
        assert.strictEqual(items[0].link, 'https://example.com/atom-post');
    });

    it('respects the per-source limit', () => {
        const items = Array.from({ length: 10 }, (_, i) => `<item><title>t${i}</title><link>https://e.com/${i}</link></item>`).join('');
        assert.strictEqual(extractFeedItems(`<rss><channel>${items}</channel></rss>`, 3).length, 3);
    });

    it('sanitizeSources drops invalid entries and backfills ids', () => {
        const result = sanitizeSources([
            { name: 'Good', url: 'https://ok.example/feed' },
            { name: '', url: 'https://x.example' },
            { name: 'No url' },
            'garbage',
            null,
        ]);
        assert.strictEqual(result.length, 1);
        assert.ok(result[0].id.length > 0);
        assert.strictEqual(result[0].name, 'Good');
    });

    it('makeSourceId produces unique ids', () => {
        const a = makeSourceId();
        const b = makeSourceId();
        assert.notStrictEqual(a, b);
    });

    it('buildNewsDigest lists items and marks failed feeds', () => {
        const digest = buildNewsDigest(
            [
                { source: { id: 'a', name: 'Good Feed', url: 'https://a.example' }, items: [{ title: 'Story one', link: 'https://a.example/1', date: 'Mon, 01 Jan 2026' }] },
                { source: { id: 'b', name: 'Bad Feed', url: 'https://b.example' }, items: [], error: 'HTTP 404' },
            ],
            new Date('2026-01-01T00:00:00Z'),
        );
        assert.ok(digest.includes('Good Feed'));
        assert.ok(digest.includes('Story one'));
        assert.ok(digest.includes('https://a.example/1'));
        assert.ok(digest.includes('Bad Feed'));
        assert.ok(digest.includes('feed unavailable: HTTP 404'));
        assert.ok(digest.toLowerCase().includes('summarize'));
    });
});
