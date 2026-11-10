import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/agent.ts', 'utf8');

if (!s.includes('async function fetchPage(apiKey: string')) {
  // already renamed in the failed previous run; check
  throw new Error('fetchPage not found (already renamed?)');
}

function replaceOnce(needle, replacement, label) {
  if (!s.includes(needle)) throw new Error('NOT FOUND: ' + label);
  const count = s.split(needle).length - 1;
  if (count !== 1) throw new Error('EXPECTED 1 OCCURRENCE of ' + label + ', got ' + count);
  s = s.replace(needle, replacement);
  console.log('REPLACED:', label);
}

replaceOnce(
  'async function fetchPage(apiKey: string, rawUrl: string): Promise<string> {',
  'async function fetchPageDeepSeek(apiKey: string, rawUrl: string): Promise<string> {',
  'rename fetchPage -> fetchPageDeepSeek'
);

const directFn = [
  '',
  'async function fetchPageDirect(rawUrl: string): Promise<string> {',
  '    if (rawUrl.length > 8192) {',
  "        throw new Error('Page URL is too long.');",
  '    }',
  '    const pageUrl = new URL(rawUrl);',
  "    if (!['http:', 'https:'].includes(pageUrl.protocol) || pageUrl.username || pageUrl.password) {",
  "        throw new Error('Only public HTTP(S) URLs without embedded credentials can be fetched.');",
  '    }',
  '    const body = await new Promise<string>((resolve, reject) => {',
  '        const onResponse = (response: http.IncomingMessage) => {',
  '            const chunks: Buffer[] = [];',
  '            response.on(\'data\', (chunk: Buffer | string) => {',
  '                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));',
  '            });',
  "            response.on('end', () => {",
  "                const text = Buffer.concat(chunks).toString('utf8');",
  '                const status = response.statusCode ?? 0;',
  '                if (status < 200 || status >= 300) {',
  '                    reject(new Error(`Page fetch failed: HTTP ${status}`));',
  '                    return;',
  '                }',
  '                const cleaned = text',
  '                    .replace(/<script[\\s\\S]*?<\\/script>/gi, \' \')',
  '                    .replace(/<style[\\s\\S]*?<\\/style>/gi, \' \')',
  "                    .replace(/<[^>]+>/g, ' ')",
  "                    .replace(/&nbsp;/g, ' ')",
  "                    .replace(/&amp;/g, '&')",
  "                    .replace(/&lt;/g, '<')",
  "                    .replace(/&gt;/g, '>')",
  '                    .replace(/&#39;/g, "\'")',
  '                    .replace(/&quot;/g, \'"\')',
  '                    .replace(/\\s+/g, \' \');',
  '                resolve(cleaned.trim());',
  '            });',
  '        };',
  "        const request = pageUrl.protocol === 'https:'",
  "            ? https.request(pageUrl, { method: 'GET' }, onResponse)",
  "            : http.request(pageUrl, { method: 'GET' }, onResponse);",
  "        request.setTimeout(60_000, () => request.destroy(new Error('Page fetch timed out.')));",
  "        request.on('error', reject);",
  '        request.end();',
  '    });',
  "    return JSON.stringify({ title: '', content: body.slice(0, 12000) });",
  '}',
  '',
].join('\n');

replaceOnce(
  '\nfunction getResponseText(response: DeepSeekResponse | null | undefined): string {',
  directFn + '\nfunction getResponseText(response: DeepSeekResponse | null | undefined): string {',
  'insert fetchPageDirect'
);

writeFileSync('src/agent.ts', s, 'utf8');
console.log('DONE phase 2, new length', s.length);
