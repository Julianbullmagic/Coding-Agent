import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('src/agent.ts', 'utf8');
const lines = src.split('\n');

// Find the provideSuggestions signature and the provider dispatch section.
let start = lines.findIndex((l) => l.includes('async provideSuggestions'));
console.log('--- provideSuggestions onward (first 120 lines) ---');
console.log(lines.slice(start, start + 40).join('\n'));

// Find where provider decides deepseek vs glm loop
const idx = lines.findIndex((l, i) => i > start && l.includes("provider === 'glm'"));
console.log('\n--- dispatch region ---');
console.log(lines.slice(idx - 10, idx + 40).join('\n'));
