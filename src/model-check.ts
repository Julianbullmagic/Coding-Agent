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

/**
 * The model-check feature is DeepSeek-specific: it reads DeepSeek's public
 * model list and pricing page. If a GLM (z.ai) model id leaks in here (for
 * example because the user set `codingAgent.model` to `glm-5.3` while the
 * provider selector was left on DeepSeek), `https://api.deepseek.com/models`
 * rejects the request with "The supported API model names are deepseek-flash,
 * deepseek-v4-pro, but you passed glm-5.3." Detect that shape up-front and
 * short-circuit so we never hand a non-DeepSeek id to the DeepSeek API.
 */
export function isLikelyGlmModelId(modelId: string | undefined): boolean {
    const id = (modelId ?? '').trim().toLowerCase();
    return /^(glm|z?-ai|zhipu|chatglm)[\d-]/.test(id) || id.startsWith('glm');
}

/**
 * Turn a low-level Node DNS / TCP / TLS error into a readable diagnostic so a
 * raw `getaddrinfo ENOTFOUND api.deepseek.com` (or similar) never reaches the
 * user or the self-heal log unhelpfully. Node surfaces these as `Error` objects
 * whose `code` is one of the well-known libuv/system error codes.
 *
 * The returned string is prefixed so `classifySource` (src/self-heal.ts) can
 * still recognize the producing subsystem, and includes the host that failed
 * plus a concrete next step (check the network / DNS, try again later).
 */
export function describeNetworkError(error: unknown, label: string): Error {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string'
        ? (error as NodeJS.ErrnoException).code
        : '';
    const host = (error instanceof Error && typeof (error as NodeJS.ErrnoException & { hostname?: string }).hostname === 'string')
        ? (error as NodeJS.ErrnoException & { hostname?: string }).hostname
        : extractHostname(message);

    const lower = message.toLowerCase();
    let diagnosis: string;
    if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('eai_noname') || lower.includes('getaddrinfo')) {
        diagnosis = 'could not resolve the host name (DNS lookup failed).';
    } else if (lower.includes('econnrefused')) {
        diagnosis = 'could not connect (the server refused the connection).';
    } else if (lower.includes('etimedout') || lower.includes('timed out') || lower.includes('timeout')) {
        diagnosis = 'did not respond within the allowed time.';
    } else if (lower.includes('econnreset') || lower.includes('epipe')) {
        diagnosis = 'the connection was reset while waiting for a response.';
    } else if (lower.includes('cert') || lower.includes('ssl') || lower.includes('tls') || lower.includes('uNABLE_TO_VERIFY')) {
        diagnosis = 'the TLS certificate could not be verified.';
    } else {
        diagnosis = 'the network request failed.';
    }

    const hostPart = host ? ` while reaching ${host}` : '';
    return new Error(
        `${label}${hostPart}: ${diagnosis} (${message}). Check your internet connection and DNS, then try again.`,
    );
}

function extractHostname(rawMessage: string): string {
    const match = rawMessage.match(/\b(?:getaddrinfo\s+)?(?:ENOTFOUND|EAI_[A-Z]+)\s+([^\s,;]+)/i);
    if (match && match[1] && !/^ENOTFOUND$/i.test(match[1])) {
        return match[1].replace(/[^\w.-]/g, '');
    }
    const hostMatch = rawMessage.match(/^([a-z0-9.-]+\.[a-z]{2,})/i)
        ?? rawMessage.match(/(?:connect|lookup)\s+\b([a-z0-9.-]+\.[a-z]{2,})/i);
    return hostMatch ? hostMatch[1] : '';
}

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
                    // Surface the underlying API error (e.g. "The supported API
                    // model names are ... but you passed ...") rather than a
                    // generic HTTP status, so the user sees the real cause.
                    let detail = `Model check request failed: HTTP ${status}`;
                    try {
                        const parsed = JSON.parse(body) as { error?: { message?: string } };
                        if (parsed.error?.message) detail = parsed.error.message;
                    } catch {
                        const text = body.trim();
                        if (text) detail = `Model check request failed: ${text.slice(0, 300)}`;
                    }
                    reject(new Error(detail));
                    return;
                }
                resolve(body);
            });
        };
        const options: http.RequestOptions = { method: 'GET', headers };
        const request = url.protocol === 'https:'
            ? https.request(url, options, onResponse)
            : http.request(url, options, onResponse);
        request.setTimeout(180_000, () => request.destroy(new Error('Model check request timed out.')));
        request.on('error', (error) => {
            // A low-level socket/DNS failure such as `getaddrinfo ENOTFOUND
            // api.deepseek.com` used to reject with the raw Node message, which
            // neither the user nor the self-heal log could act on. Wrap it so
            // the "Model check request failed" prefix is preserved (letting
            // classifySource file it under model-check) and the actual cause is
            // described. The request timeout above already has its own message.
            if (/timed out|timeout/i.test(error instanceof Error ? error.message : String(error))) {
                reject(new Error('Model check request timed out.'));
                return;
            }
            reject(describeNetworkError(error, 'Model check request failed'));
        });
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
    // Never probe DeepSeek with a GLM/z.ai model id. The DeepSeek /models
    // endpoint rejects non-DeepSeek ids with "The supported API model names are
    // deepseek-flash, deepseek-v4-pro, but you passed <glm-...>." Return the
    // caller's value unchanged so the check is effectively a no-op for GLM.
    if (isLikelyGlmModelId(preferredModelId)) {
        return { id: preferredModelId, name: preferredModelId, version: '' };
    }

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
