import { readFileSync } from 'fs';
const lines = readFileSync('src/agent.ts', 'utf8').split(/\r?\n/);
const show = (a, b) => { for (let i = a; i <= b; i++) console.log(`${i}: ${lines[i - 1]}`); };
show(50, 110);
console.log('---');
show(790, 830);
console.log('---');
show(640, 680);
