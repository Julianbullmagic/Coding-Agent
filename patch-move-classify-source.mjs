import fs from 'node:fs';

const CRLF = '\r\n';
function read(p) {
    const raw = fs.readFileSync(p, 'utf8');
    return { raw, s: raw.replace(/\r\n/g, '\n'), usesCrlf: raw.includes(CRLF) };
}
function write(p, s, usesCrlf) {
    fs.writeFileSync(p, usesCrlf ? s.replace(/\n/g, CRLF) : s);
}

// --- 1. Add classifySource to src/self-heal.ts (no vscode import => testable). ---
{
    const { s, usesCrlf } = read('src/self-heal.ts');
    if (s.includes('export function classifySource')) throw new Error('self-heal.ts already patched');

    const marker = '/** Build a stable, short fingerprint from source + message. */';
    if (!s.includes(marker)) throw new Error('fingerprint marker not found in self-heal.ts');

    const classifier = `/**
 * Classify an error message into an ErrorSource so the self-heal log records
 * it under the right category and a later success (resolveSource) can clear it.
 *
 * Order matters: provider-specific checks run first. GLM/z.ai errors such as
 * "The supported API model names are deepseek-flash, deepseek-v4-pro, but you
 * passed glm-5.3." contain the word "model", so a generic 'model' check that
 * ran earlier would misfile them as model-check. They would then never be
 * marked resolved by a successful GLM request (which resolves 'glm-request')
 * and the self-heal pass would re-queue them forever.
 */
export function classifySource(error: unknown): ErrorSource {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    // Provider-specific checks first (GLM is the most specific provider tag).
    if (lower.includes('glm') || lower.includes('zhipu') || lower.includes('bigmodel')) return 'glm-request';
    if (lower.includes('gmail') || lower.includes('mail')) return 'gmail';
    if (lower.includes('calendar') || lower.includes('event')) return 'calendar';
    if (lower.includes('github') || lower.includes('gh ')) return 'github';
    if (lower.includes('backup')) return 'backup';
    if (lower.includes('repo') || lower.includes('bootstrap')) return 'repo-bootstrap';
    if (lower.includes('deepseek')) return 'deepseek-request';
    // Precise model-check matches: the strings actually thrown by
    // src/model-check.ts (request failure, unreadable model list, timeout),
    // rather than any message that merely mentions "model".
    if (lower.includes('model check request failed') || lower.includes('model check request timed out') || lower.includes('unreadable model list')) return 'model-check';
    return 'unknown';
}

`;

    const updated = s.replace(marker, classifier + marker);
    write('src/self-heal.ts', updated, usesCrlf);
    console.log('patched self-heal.ts: added exported classifySource');
}

// --- 2. In src/extension.ts, replace the local classifySource with an import. ---
{
    const { s, usesCrlf } = read('src/extension.ts');
    if (s.includes("    classifySource,\n")) throw new Error('extension.ts already patched');

    const importMarker = `    bumpRepairAttempts,
    ErrorSource,
} from './self-heal';`;
    if (!s.includes(importMarker)) throw new Error('self-heal import marker not found in extension.ts');

    // Drop the now-unused ErrorSource import? classifySource needs it no longer;
    // but other code may use ErrorSource. Check usage.
    const usesErrorSourceType = /ErrorSource/.test(s.replace(importMarker, ''));
    const newImport = usesErrorSourceType
        ? `    classifySource,
    ErrorSource,
} from './self-heal';`
        : `    classifySource,
} from './self-heal';`;
    let updated = s.replace(importMarker, newImport);

    // Remove the local (already-reordered) classifySource definition.
    const localBlockRegex = /function classifySource\(error: unknown\): ErrorSource \{[\s\S]*?\n\}\n\n/;
    if (!localBlockRegex.test(updated)) throw new Error('local classifySource not found in extension.ts');
    updated = updated.replace(localBlockRegex, '');

    write('src/extension.ts', updated, usesCrlf);
    console.log('patched extension.ts: classifySource imported from self-heal, local copy removed');
}
