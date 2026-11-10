import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/agent.ts', 'utf8');
const original = s;

function replaceOnce(needle, replacement, label) {
  if (!s.includes(needle)) {
    throw new Error('NOT FOUND: ' + label);
  }
  const count = s.split(needle).length - 1;
  if (count !== 1) {
    throw new Error('EXPECTED 1 OCCURRENCE of ' + label + ', got ' + count);
  }
  s = s.replace(needle, replacement);
  console.log('REPLACED:', label);
}

// 1. Add provider imports after the gmail import.
replaceOnce(
  "import type { GmailToolArgs } from './gmail';",
  "import type { GmailToolArgs } from './gmail';\nimport {\n    Provider,\n    resolveProvider,\n    KIMI_TOOL_DEFINITIONS,\n    KimiCompletionResponse,\n    KimiToolCall,\n} from './providers';",
  'provider-import'
);

writeFileSync('src/agent.ts', s, 'utf8');
console.log('DONE phase 1, new length', s.length);
