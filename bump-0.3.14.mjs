import { readFileSync, writeFileSync } from 'node:fs';

for (const file of ['package.json', 'package-lock.json']) {
    let s = readFileSync(file, 'utf8');
    s = s.replace('"version": "0.3.13"', '"version": "0.3.14"');
    writeFileSync(file, s, 'utf8');
}
console.log('bumped to 0.3.14');
