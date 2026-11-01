import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/extension.ts';
let src = readFileSync(path, 'utf8');

const before = `const conversation=(state.conversations||[]).find(item=>item.id===state.activeId);`;
const after = `const conversation=(state.conversations||[]).find(item=>item.id===state.activeId)||(state.conversations&&state.conversations[0]);`;

const count = src.split(before).length - 1;
if (count !== 1) {
    throw new Error(`expected exactly 1 occurrence, found ${count}`);
}
src = src.replace(before, after);
writeFileSync(path, src, 'utf8');
console.log('OK  frontend conversation fallback');
