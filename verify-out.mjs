import { readFileSync, rmSync } from 'fs';

const s = readFileSync('out/src/providers.js', 'utf8');
console.log('api.z.ai:', s.includes('api.z.ai'));
console.log('glm-4.6:', s.includes('glm-4.6'));
console.log('bigmodel remaining:', s.includes('bigmodel'));
console.log('reasoning_content:', s.includes('reasoning_content'));
console.log('extractGlmText:', s.includes('extractGlmText'));

const a = readFileSync('out/src/agent.js', 'utf8');
console.log('agent uses extractGlmText:', a.includes('extractGlmText'));

// self-cleanup
rmSync(new URL(import.meta.url).pathname, { force: true });
