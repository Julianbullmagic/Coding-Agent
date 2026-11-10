import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/agent.ts', 'utf8');

const needle = "messages.push({ role: 'assistant', content: message.content, tool_calls: toolCalls });";
const replacement = "messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls });";

if (!s.includes(needle)) throw new Error('needle not found');
const count = s.split(needle).length - 1;
if (count !== 1) throw new Error('count ' + count);
s = s.replace(needle, replacement);
writeFileSync('src/agent.ts', s, 'utf8');
console.log('fixed content type coercion');
