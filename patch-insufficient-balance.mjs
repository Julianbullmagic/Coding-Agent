// One-off patch: add retry + diagnosis for transient DeepSeek API errors
// (e.g. "Insufficient Balance" flapping, 429/5xx) in src/agent.ts.
import { readFile, writeFile } from 'fs/promises';

const path = 'src/agent.ts';
let source = await readFile(path, 'utf8');

if (source.includes('interpretDeepSeekError')) {
    console.log('Already patched; skipping.');
    process.exit(0);
}

const helper = `
/**
 * Wrap a low-level DeepSeek API error message with a diagnosis and a concrete
 * next step. Raw strings like "Insufficient Balance (request_id: ...)" used to
 * reach the user unexplained, so the same failure kept recurring without an
 * obvious cause.
 */
export function interpretDeepSeekError(message: string): string {
    const raw = (message ?? '').trim();
    const lower = raw.toLowerCase();

    if (lower.includes('insufficient balance') || lower.includes('insufficient_quota')) {
        return [
            'DeepSeek request failed: ' + raw,
            '',
            'Diagnosis: the DeepSeek account has run out of credit/balance, so the API rejected the request.',
            'Fix: top up the account at https://platform.deepseek.com, or switch providers via the "codingAgent.provider" setting.',
            'The request is retried a few times automatically in case the balance is restored, but it cannot succeed without credit.',
        ].join('\\n');
    }
    if (lower.includes('429') || lower.includes('rate limit')) {
        return [
            'DeepSeek request failed: ' + raw,
            '',
            'Diagnosis: the API rate limit was hit.',
            'Fix: the request is retried automatically with backoff; if it persists, slow down or use a lighter model.',
        ].join('\\n');
    }
    if (lower.includes('402') || lower.includes('payment required')) {
        return [
            'DeepSeek request failed: ' + raw,
            '',
            'Diagnosis: payment is required — the account balance is exhausted.',
            'Fix: top up the account at https://platform.deepseek.com.',
        ].join('\\n');
    }
    if (lower.includes('authentication') || lower.includes('invalid api key') || lower.includes('401')) {
        return [
            'DeepSeek request failed: ' + raw,
            '',
            'Diagnosis: the stored DeepSeek API key was rejected.',
            'Fix: re-enter the API key via the extension settings and reload the window.',
        ].join('\\n');
    }
    return 'DeepSeek request failed: ' + raw;
}

/**
 * Run a JSON request with a bounded retry for transient failures: rate
 * limits, temporary server errors (5xx), and short billing hiccups such as
 * "Insufficient Balance" that resolve once the account is topped up.
 * Permanent errors (auth, unknown model) surface immediately with a
 * diagnosis via interpretDeepSeekError.
 */
async function requestJsonWithRetry<T>(
    url: URL,
    body: string | undefined,
    apiKey: string | undefined,
    maxAttempts: number = 3,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await requestJson<T>(url, body, apiKey);
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            const lower = message.toLowerCase();
            const isTransient = /insufficient balance|rate limit|429|http 5\\d\\d|server error|timed out/i.test(lower);
            if (!isTransient || attempt === maxAttempts) {
                throw new Error(interpretDeepSeekError(message));
            }
            // Small backoff before retrying a transient failure.
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
    }
    throw new Error(interpretDeepSeekError(lastError instanceof Error ? lastError.message : String(lastError)));
}
`;

// Insert helpers right before resolveWorkspacePath.
const anchor = 'function resolveWorkspacePath(';
if (!source.includes(anchor)) {
    throw new Error('Anchor not found in agent.ts');
}
source = source.replace(anchor, helper.trimStart() + '\n\n' + anchor);

// Route both agent request sites through the retrying wrapper.
source = source.replace(
    'const response: DeepSeekResponse | null = await requestJson<DeepSeekResponse | null>(',
    'const response: DeepSeekResponse | null = await requestJsonWithRetry<DeepSeekResponse | null>(',
);
source = source.replace(
    'response = await requestJson<GlmCompletionResponse>(',
    'response = await requestJsonWithRetry<GlmCompletionResponse>(',
);

await writeFile(path, source, 'utf8');
console.log('Patched src/agent.ts with interpretDeepSeekError + requestJsonWithRetry.');
