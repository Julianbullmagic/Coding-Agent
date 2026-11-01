import { readFileSync, writeFileSync } from 'node:fs';

const p = 'package.json';
let s = readFileSync(p, 'utf8');
s = s.replace('"version": "0.1.2"', '"version": "0.2.0"');
writeFileSync(p, s);

const parsed = JSON.parse(s);
console.log('version is now', parsed.version);
