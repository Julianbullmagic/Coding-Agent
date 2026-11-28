// Show the active provider in the composer placeholder so the user always
// knows which model will answer, e.g. "Message GLM (z.ai)...".
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/extension.ts';
let s = readFileSync(file, 'utf8');

const oldRender = `state=event.data;renderProgress();modelDeepseek.classList.toggle('active',state.provider!=='glm');modelGlm.classList.toggle('active',state.provider==='glm');`;
const newRender = `state=event.data;renderProgress();modelDeepseek.classList.toggle('active',state.provider!=='glm');modelGlm.classList.toggle('active',state.provider==='glm');input.placeholder='Message '+(state.provider==='glm'?'GLM (z.ai)':'DeepSeek')+'...';`;
if (!s.includes(oldRender)) throw new Error('state render block not found');
s = s.replace(oldRender, newRender);

writeFileSync(file, s, 'utf8');
console.log('patched placeholder successfully');
