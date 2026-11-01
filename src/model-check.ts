import * as http from 'http';
import * as https from 'https';

export interface ModelInfo {
    /** Stable API alias that always routes to the latest build (e.g. `deepseek-v4-pro`). */
    id: string;
    /** Human-readable model name from the list-models endpoint (e.g. `DeepSeek-V4-Pro`). */
    name: string;
    /** Pinned build version reported on the Models & Pricing page (e.g. `DeepSeek-V4-Pro-0813`). */
    version: string;
}

interface ListModelsResponse {
    data?: Array<{
        id?: string;
        name?: string;
        owned_by?: string;
    }>;
}

const MODELS_ENDPOINT = 'https://api.deepseek.com/models';
const PRICING_PAGE_URL = 'https://api-docs.deepseek.com/quick_start/pricing';

function requestText(url: URL, apiKey?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const headers: http.OutgoingHttpHeaders = { Accept: 'application/json,text/html,*/*' };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }
        const onResponse = (response: http.IncomingMessage) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer | string) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const status = response.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    reject(new Error(`Model check request failed: HTTP ${status}`));
                    return;
                }
                resolve(body);
            });
        };
        const options: http.RequestOptions = { method: 'GET', headers };
        const request = url.protocol === 'https:'
            ? https.request(url, options, onResponse)
            : http.request(url, options, onResponse);
        request.setTimeout(60_000, () => request.destroy(new Error('Model check request timed out.')));
        request.on('error', reject);
        request.end();
    });
}

/** Fetch the currently available DeepSeek models from the public list-models endpoint. */
export async function fetchAvailableModels(apiKey?: string): Promise<Array<{ id: string; name: string }>> {
    const body = await requestText(new URL(MODELS_ENDPOINT), apiKey);
    let parsed: ListModelsResponse;
    try {
        parsed = JSON.parse(body) as ListModelsResponse;
    } catch {
        throw new Error('DeepSeek returned an unreadable model list.');
    }
    return (parsed.data ?? [])
        .filter((model) => typeof model.id === 'string' && model.id.length > 0)
        .map((model) => ({
            id: model.id as string,
            name: typeof model.name === 'string' && model.name.length > 0 ? (model.name as string) : (model.id as string),
        }));
}

/**
 * Extract the pinned model version for a given model alias from the Models & Pricing page.
 * The page has a "MODEL VERSION" cell such as "DeepSeek-V4-Pro-0813". We find the row whose
 * first cell matches the alias and return the version token.
 */
export function extractModelVersion(pricingHtml: string, modelId: string): string {
    const text = pricingHtml
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ');

    const alias = modelId.trim().toLowerCase();
    const aliasIndex = text.toLowerCase().indexOf(alias);
    if (aliasIndex < 0) {
        return '';
    }
    const afterAlias = text.slice(aliasIndex + alias.length, aliasIndex + alias.length + 2000);
    const versionMatch = afterAlias.match(/DeepSeek[-\s]V\s?\d+(?:\.\d+)?[-\s](?:Pro|Flash|Reasoner|Chat|Coder|R1)[-][A-Za-z0-9]+/i);
    return versionMatch ? versionMatch[0].replace(/\s+/g, '-') : '';
}

/**
 * Compute the "latest" available model for a configured model family by reading the
 * public model list and the pinned version from the pricing page.
 */
export async function checkLatestModel(
    apiKey: string | undefined,
    preferredModelId: string,
): Promise<ModelInfo> {
    const available = await fetchAvailableModels(apiKey);
    let selectedId = preferredModelId;
    if (!available.some((model) => model.id === preferredModelId)) {
        selectedId = available.find((model) => model.id.startsWith('deepseek-'))?.id
            ?? available[0]?.id
            ?? preferredModelId;
    }
    const selected = available.find((model) => model.id === selectedId);
    const displayName = selected?.name ?? selectedId;

    let version = '';
    try {
        const pricingHtml = await requestText(new URL(PRICING_PAGE_URL));
        version = extractModelVersion(pricingHtml, selectedId);
    } catch {
        // The pricing page is a best-effort enhancement. Keep going without a pinned version.
    }

    return { id: selectedId, name: displayName, version };
}

/**
 * Compare two version strings. Returns a positive number if `b` is newer than `a`,
 * negative if older, and zero if equal.
 */
export function compareVersions(a: string, b: string): number {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const dateToken = (value: string): string => {
        // Capture a trailing dated token such as "-0813" or "1017".
        const match = value.match(/(\d{4})(?!\d)/);
        return match ? match[1] : value;
    };
    const aDate = dateToken(a);
    const bDate = dateToken(b);
    const aNum = Number(aDate);
    const bNum = Number(bDate);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) {
        return bNum - aNum;
    }
    return b.localeCompare(a);
}
