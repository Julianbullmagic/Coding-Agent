import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/extension.ts', 'utf8');

function replaceOnce(needle, replacement, label) {
  if (!s.includes(needle)) throw new Error('NOT FOUND: ' + label);
  const count = s.split(needle).length - 1;
  if (count !== 1) throw new Error('EXPECTED 1 of ' + label + ', got ' + count);
  s = s.replace(needle, replacement);
  console.log('OK', label);
}

// Replace the apiKey resolution block in send()
replaceOnce(
  `        const apiKey = await this.context.secrets.get(API_KEY_SECRET);
        if (!apiKey) {
            await vscode.commands.executeCommand('codingAgent.setApiKey');
            this.postState(view);
            return;
        }
        try {`,
  `        const provider = this.currentProvider();
        const modelKey = provider === 'kimi' ? KIMI_MODEL_KEY : DEEPSEEK_MODEL_KEY;
        const modelId = vscode.workspace.getConfiguration('codingAgent').get<string>(modelKey, provider === 'kimi' ? 'kimi-k3' : 'deepseek-v4-pro');
        this.agent.setModel(modelId);

        const apiKey = provider === 'kimi'
            ? await this.context.secrets.get(KIMI_API_KEY_SECRET)
            : await this.context.secrets.get(API_KEY_SECRET);
        if (!apiKey) {
            if (provider === 'kimi') {
                await vscode.commands.executeCommand('codingAgent.setKimiApiKey');
            } else {
                await vscode.commands.executeCommand('codingAgent.setApiKey');
            }
            this.postState(view);
            return;
        }
        try {`,
  'apiKey resolution block'
);

// Replace the provideSuggestions call
replaceOnce(
  `            const response = await this.agent.provideSuggestions(effectivePrompt, apiKey, searxngBaseUrl, history, workspacePath, maxToolRounds);`,
  `            const response = await this.agent.provideSuggestions(effectivePrompt, apiKey, searxngBaseUrl, history, workspacePath, maxToolRounds, provider);`,
  'provideSuggestions call'
);

writeFileSync('src/extension.ts', s, 'utf8');
console.log('DONE B, length', s.length);
