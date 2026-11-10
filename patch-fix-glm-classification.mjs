import fs from 'node:fs';

// Normalize CRLF/LF for reliable exact-string matching, restore on write.
const CRLF = '\r\n';
const raw = fs.readFileSync('src/extension.ts', 'utf8');
const usesCrlf = raw.includes(CRLF);
let s = raw.replace(/\r\n/g, '\n');

// Fix classifySource: GLM request errors such as
//   "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed glm-5.3."
// contain the word "model", so the `lower.includes('model')` check ran first and
// misfiled them as 'model-check'. That prevented resolveSource('glm-request')
// from ever marking them resolved, so the self-heal pass re-queued them forever.
// Reorder so GLM is checked before the generic 'model' check, and make the
// model-check match precise (the strings actually thrown by src/model-check.ts).

const oldBlock = `function classifySource(error: unknown): ErrorSource {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes('gmail') || lower.includes('mail')) return 'gmail';
    if (lower.includes('calendar') || lower.includes('event')) return 'calendar';
    if (lower.includes('github') || lower.includes('gh ')) return 'github';
    if (lower.includes('backup')) return 'backup';
    if (lower.includes('model')) return 'model-check';
    if (lower.includes('repo') || lower.includes('bootstrap')) return 'repo-bootstrap';
    if (lower.includes('glm') || lower.includes('zhipu') || lower.includes('bigmodel')) return 'glm-request';
    if (lower.includes('deepseek')) return 'deepseek-request';
    return 'unknown';
}`;

const newBlock = `function classifySource(error: unknown): ErrorSource {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    // Provider-specific checks MUST come before any generic 'model' check.
    // GLM/z.ai errors (e.g. "The supported API model names are ... but you
    // passed glm-5.3.") contain the word "model", so an early 'model' check
    // would misfile them as model-check, and they could then never be marked
    // resolved by a successful GLM request (which resolves 'glm-request').
    if (lower.includes('glm') || lower.includes('zhipu') || lower.includes('bigmodel')) return 'glm-request';
    if (lower.includes('gmail') || lower.includes('mail')) return 'gmail';
    if (lower.includes('calendar') || lower.includes('event')) return 'calendar';
    if (lower.includes('github') || lower.includes('gh ')) return 'github';
    if (lower.includes('backup')) return 'backup';
    if (lower.includes('repo') || lower.includes('bootstrap')) return 'repo-bootstrap';
    if (lower.includes('deepseek')) return 'deepseek-request';
    // Precise model-check matches: the strings thrown by src/model-check.ts
    // (request failure, unreadable model list, timeout) rather than any
    // message that merely mentions "model".
    if (lower.includes('model check request failed') || lower.includes('model check request timed out') || lower.includes('unreadable model list')) return 'model-check';
    return 'unknown';
}`;

if (!s.includes(oldBlock)) throw new Error('classifySource block not found (already patched?)');
if (s.includes(newBlock)) throw new Error('classifySource already patched');
s = s.replace(oldBlock, newBlock);

fs.writeFileSync('src/extension.ts', usesCrlf ? s.replace(/\n/g, CRLF) : s);
console.log('patched extension.ts: classifySource now checks GLM before the generic model check');
