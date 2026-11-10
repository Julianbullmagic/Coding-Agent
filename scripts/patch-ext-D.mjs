import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/extension.ts', 'utf8');

function replaceOnce(needle, replacement, label) {
  if (!s.includes(needle)) throw new Error('NOT FOUND: ' + label);
  const count = s.split(needle).length - 1;
  if (count !== 1) throw new Error('EXPECTED 1 of ' + label + ', got ' + count);
  s = s.replace(needle, replacement);
  console.log('OK', label);
}

replaceOnce(
  `    private conversations(): Conversation[] {`,
  `    private currentProvider(): Provider {
        const stored = this.context.workspaceState.get<string>(PROVIDER_KEY);
        return stored === 'kimi' ? 'kimi' : 'deepseek';
    }

    private async setProvider(provider: string): Promise<void> {
        const normalized: Provider = provider === 'kimi' ? 'kimi' : 'deepseek';
        await this.context.workspaceState.update(PROVIDER_KEY, normalized);
        if (normalized === 'deepseek') {
            const model = vscode.workspace.getConfiguration('codingAgent').get<string>(DEEPSEEK_MODEL_KEY, 'deepseek-v4-pro');
            this.agent.setModel(model);
        } else {
            const model = vscode.workspace.getConfiguration('codingAgent').get<string>(KIMI_MODEL_KEY, 'kimi-k3');
            this.agent.setModel(model);
        }
    }

    private conversations(): Conversation[] {`,
  'add provider helpers'
);

writeFileSync('src/extension.ts', s, 'utf8');
console.log('DONE D, length', s.length);
