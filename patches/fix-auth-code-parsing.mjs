import { readFileSync, writeFileSync } from 'node:fs';

const NEW_GMAIL_FN = [
  '/**',
  ' * Extract the OAuth `code` from user input, tolerating a full redirect URL,',
  ' * a bare `code=...` fragment, a raw code, or a percent-encoded code.',
  ' *',
  ' * Google authorization codes look like `4/0Aea...` - note the `/`. In the',
  ' * address bar after a redirect to http://localhost the `/` arrives',
  ' * percent-encoded as `%2F` (e.g. `4%2F0Aea...`). This function therefore:',
  ' *   1. pulls `code` out of any http(s) redirect URL (URLSearchParams',
  ' *      already decodes `%2F` back to `/`),',
  ' *   2. pulls `code` out of a bare `code=...&scope=...` fragment that lacks',
  ' *      an explicit URL scheme,',
  ' *   3. returns a lone token verbatim, percent-decoding it exactly once when',
  ' *      it contains `%` sequences (so `4%2F0Aea...` becomes `4/0Aea...`),',
  ' *   4. strips trailing whitespace/query noise defensively.',
  ' *',
  ' * It never truncates a legitimate code that contains `/`.',
  ' */',
  'export function extractGmailAuthorizationCode(input: string): string {',
  "    const trimmed = input.trim();",
  "    if (!trimmed) return '';",
  '',
  '    // Full redirect URL: pull the `code` query param (also decodes %2F -> /).',
  '    if (/^https?:\\/\\//i.test(trimmed)) {',
  '        try {',
  '            const url = new URL(trimmed);',
  "            const code = url.searchParams.get('code');",
  '            if (code) return code;',
  '        } catch {',
  '            // Not a parseable URL; fall through.',
  '        }',
  '    }',
  '',
  '    // Bare "code=..." fragment without an explicit scheme (e.g. what a user',
  '    // might copy out of a URL bar that dropped the scheme).',
  "    const codeMatch = trimmed.match(/(?:^|[?&])code=([^&#\\s]+)/);",
  '    if (codeMatch) {',
  '        const raw = codeMatch[1];',
  '        return decodeOnce(raw);',
  '    }',
  '',
  '    // A lone token: percent-decode once if it contains "%" escape sequences,',
  "    // otherwise return verbatim (so '4/0Aea...' with a literal slash survives).",
  '    return decodeOnce(trimmed);',
  '}',
  '',
  '/** Percent-decode a code exactly once, falling back to verbatim on bad input. */',
  'function decodeOnce(value: string): string {',
  "    if (!value.includes('%')) return value;",
  '    try {',
  '        const decoded = decodeURIComponent(value);',
  "        // A legitimate Google code keeps '/' and never round-trips to more %.",
  "        if (!decoded.includes('%')) return decoded;",
  '    } catch {',
  '        // Malformed percent-encoding; use the raw value.',
  '    }',
  '    return value;',
  '}',
].join('\n');

const NEW_CALENDAR_FN = NEW_GMAIL_FN.replace('extractGmailAuthorizationCode', 'extractAuthorizationCode');

// ---- Patch gmail.ts ----
const gmailFile = 'src/gmail.ts';
let gmail = readFileSync(gmailFile, 'utf8');

const gmailStart = '/**\n * Extract the OAuth `code` from user input, tolerating a full redirect URL';
const gmailEnd = '    // Defensive fallback: strip trailing query-string / whitespace.\n    return trimmed.split(/[&\\s]/)[0];\n}';

if (!gmail.includes(gmailStart) || !gmail.includes(gmailEnd)) {
    throw new Error('gmail.ts extract function anchors not found - aborting.');
}

const gmailStartIndex = gmail.indexOf(gmailStart);
const gmailEndIndex = gmail.indexOf(gmailEnd) + gmailEnd.length;
gmail = gmail.slice(0, gmailStartIndex) + NEW_GMAIL_FN + gmail.slice(gmailEndIndex);
writeFileSync(gmailFile, gmail, 'utf8');

// ---- Patch google-calendar.ts ----
const calendarFile = 'src/google-calendar.ts';
let calendar = readFileSync(calendarFile, 'utf8');

const calStart = '/**\n * Extract the OAuth authorization `code` from user input, tolerating:';
const calEnd = '    // Fallback: strip any trailing query-string or whitespace (defensive).\n    return trimmed.split(/[&\\s]/)[0];\n}';

if (!calendar.includes(calStart) || !calendar.includes(calEnd)) {
    throw new Error('google-calendar.ts extract function anchors not found - aborting.');
}

const calStartIndex = calendar.indexOf(calStart);
const calEndIndex = calendar.indexOf(calEnd) + calEnd.length;
calendar = calendar.slice(0, calStartIndex) + NEW_CALENDAR_FN + calendar.slice(calEndIndex);
writeFileSync(calendarFile, calendar, 'utf8');

console.log('Patched extractAuthorizationCode in both gmail.ts and google-calendar.ts.');
