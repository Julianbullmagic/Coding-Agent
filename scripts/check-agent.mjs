import { readFileSync } from 'fs';
const s = readFileSync('src/agent.ts', 'utf8');
console.log('len', s.length);
console.log('has CodingAgent class', s.includes('export class CodingAgent'));
console.log('has provideKimiSuggestions', s.includes('provideKimiSuggestions'));
console.log('has requestJson', s.includes('function requestJson'));
console.log('has TOOLS', s.includes('const TOOLS'));
