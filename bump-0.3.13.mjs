import fs from 'fs';
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = '0.3.13';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
console.log('version:', p.version);
