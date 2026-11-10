import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/extension.ts', 'utf8');

function replaceOnce(needle, replacement, label) {
  if (!s.includes(needle)) throw new Error('NOT FOUND: ' + label);
  const count = s.split(needle).length - 1;
  if (count !== 1) throw new Error('EXPECTED 1 of ' + label + ', got ' + count);
  s = s.replace(needle, replacement);
  console.log('OK', label);
}

// 1. add provider import
replaceOnce(
  "import { LOGIN_COMMAND, LOGIN_TERMINAL_NAME, LOGIN_POLL_INTERVAL_MS, LOGIN_POLL_TIMEOUT_MS, shouldKeepPolling, nextPollDelay, buildLoginSuccessMessage, buildLoginTimeoutWarning } from './login-flow';",
  "import { LOGIN_COMMAND, LOGIN_TERMINAL_NAME, LOGIN_POLL_INTERVAL_MS, LOGIN_POLL_TIMEOUT_MS, shouldKeepPolling, nextPollDelay, buildLoginSuccessMessage, buildLoginTimeoutWarning } from './login-flow';\nimport { KIMI_API_KEY_SECRET, PROVIDER_KEY, KIMI_MODEL_KEY, Provider } from './providers';",
  'provider import'
);

// 2. constants: add deepseek model key near API_KEY_SECRET
replaceOnce(
  "const API_KEY_SECRET = 'codingAgent.deepseekApiKey';",
  "const API_KEY_SECRET = 'codingAgent.deepseekApiKey';\nconst DEEPSEEK_MODEL_KEY = 'codingAgent.model';",
  'model key constant'
);

writeFileSync('src/extension.ts', s, 'utf8');
console.log('DONE A, length', s.length);
