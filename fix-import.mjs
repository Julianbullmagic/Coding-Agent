import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/extension.ts';
const src = readFileSync(file, 'utf8');

const find = "import { ensureRepoOnOpen, slugifyRepoName } from './repo-bootstrap';";
const replace = "import { ensureRepoOnOpen } from './repo-bootstrap';";

if (!src.includes(find)) {
    console.error('Anchor not found.');
    process.exit(1);
}
writeFileSync(file, src.replace(find, replace), 'utf8');
console.log('OK: dropped unused slugifyRepoName import.');
