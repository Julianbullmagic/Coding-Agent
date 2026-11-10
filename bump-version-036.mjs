import { readFileSync, writeFileSync } from 'node:fs';

const p = 'package.json';
let s = readFileSync(p, 'utf8');
const from = '0.3.5';
const to = '0.3.6';
if (!s.includes(`"version": "${from}"`)) {
  throw new Error(`Expected version ${from} in package.json`);
}
s = s.replace(`"version": "${from}"`, `"version": "${to}"`);
writeFileSync(p, s);

const parsed = JSON.parse(s);
console.log('version is now', parsed.version);
