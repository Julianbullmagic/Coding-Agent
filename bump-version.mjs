import { readFileSync, writeFileSync } from 'node:fs';

const p = 'package.json';
let s = readFileSync(p, 'utf8');
s = s.replace('"version": "0.3.5"', '"version": "0.3.6"');
writeFileSync(p, s);

const parsed = JSON.parse(s);
console.log('version is now', parsed.version);
