import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 4) + '\n');
console.log('Bumped version to ' + pkg.version);
