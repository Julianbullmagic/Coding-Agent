import { readFileSync } from 'fs';
const s = readFileSync('src/agent.ts', 'utf8');
const idx = s.indexOf('export class CodingAgent');
console.log('class idx', idx);
const tail = s.slice(idx);
console.log('--- anchors ---');
for (const anchor of [
  '    async provideSuggestions(',
  '    // Retrieve relevant context from earlier conversations via the RAG module.',
  "        throw new Error('DeepSeek did not complete the response.');",
  '    private async retrieveContext(query: string): Promise<string> {',
]) {
  console.log(JSON.stringify(anchor), '=>', tail.indexOf(anchor));
}
