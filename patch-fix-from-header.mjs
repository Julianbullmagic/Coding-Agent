import { readFileSync, writeFileSync } from 'fs';

const file = 'src/gmail.ts';
let s = readFileSync(file, 'utf8');

// The problem: `From: me` is not a valid RFC 5322 address and causes the
// Gmail API to reject messages.send with "400 Invalid From header".
// Gmail auto-uses the authenticated account's address, so drop the header.
const target = [
    '        const headers = [',
    '            `From: me`,',
    '            `To: ${to}`,',
].join('\n');

const replacement = [
    '        const headers = [',
    '            `To: ${to}`,',
].join('\n');

if (!s.includes(target)) {
    console.error('TARGET NOT FOUND — aborting.');
    process.exit(1);
}

s = s.replace(target, replacement);
writeFileSync(file, s);
console.log('Patched src/gmail.ts: removed invalid "From: me" header.');
