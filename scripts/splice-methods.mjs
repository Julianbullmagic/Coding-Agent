import { readFileSync, writeFileSync } from 'fs';

let s = readFileSync('src/agent.ts', 'utf8');
const methods = readFileSync('scripts/new-methods.ts.txt', 'utf8');

const startAnchor = '    async provideSuggestions(';
const endAnchor = '    // Retrieve relevant context from earlier conversations via the RAG module.';

const startIdx = s.indexOf(startAnchor);
const endIdx = s.indexOf(endAnchor);
if (startIdx < 0) throw new Error('start anchor not found');
if (endIdx < 0) throw new Error('end anchor not found');
if (endIdx < startIdx) throw new Error('anchors out of order');

// Ensure the old method tail ends with the expected throw right before endAnchor.
const between = s.slice(startIdx, endIdx);
if (!between.includes("throw new Error('DeepSeek did not complete the response.');")) {
  throw new Error('expected old method tail not found');
}

// The endAnchor line should be preserved. Insert new methods, then a newline, then endAnchor.
s = s.slice(0, startIdx) + methods + s.slice(endIdx);

writeFileSync('src/agent.ts', s, 'utf8');
console.log('SPLICED, new length', s.length);
