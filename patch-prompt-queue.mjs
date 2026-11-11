// Add a persistent prompt queue to the chat: enqueue, delete, clear, and stop,
// with sequential background processing so the composer never blocks.
import { readFileSync, writeFileSync } from 'fs';

const file = 'src/extension.ts';
let s = readFileSync(file, 'utf8');

function ensure(predicate, label) {
    if (!predicate()) throw new Error('anchor not found: ' + label);
}

// 1. Import the queue helpers.
const importOld = "import { GLM_API_KEY_SECRET, PROVIDER_KEY, GLM_MODEL_KEY, GLM_DEFAULT_MODEL, Provider } from './providers';";
const importNew = importOld + "\nimport { PromptQueueItem, enqueuePrompt, removePrompt, shiftPrompt } from './prompt-queue';";
ensure(() => s.includes(importOld) && !s.includes("from './prompt-queue'"), 'import');
s = s.replace(importOld, importNew);

// 2. Add the queue state key constants near the other state keys.
const constOld = "const API_KEY_SECRET = 'codingAgent.deepseekApiKey';\nconst DEEPSEEK_MODEL_KEY = 'codingAgent.model';";
const constNew = "const API_KEY_SECRET = 'codingAgent.deepseekApiKey';\nconst DEEPSEEK_MODEL_KEY = 'codingAgent.model';\nconst PROMPT_QUEUE_KEY = 'codingAgent.promptQueue';\nconst PROMPT_QUEUE_STOP_KEY = 'codingAgent.promptQueueStop';";
ensure(() => s.includes(constOld), 'const keys');
s = s.replace(constOld, constNew);

writeFileSync(file, s, 'utf8');
console.log('step 1-2 complete');
