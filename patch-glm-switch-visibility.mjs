// Patch: surface missing GLM API key in chat instead of failing silently.
// In runOne(), when the selected provider has no stored key, the code opened
// the key-input command and returned. From the chat this looked like the
// message vanished with no response -- and for GLM it explained "zero GLM
// credits used". Now the reason is posted as an assistant message.
import { readFileSync, writeFileSync } from 'fs';

const file = 'src/extension.ts';
let src = readFileSync(file, 'utf8');

const before = `        if (!apiKey) {
            if (provider === 'glm') {
                await vscode.commands.executeCommand('codingAgent.setGLMApiKey');
            } else {
                await vscode.commands.executeCommand('codingAgent.setApiKey');
            }
            this.postState(view);
            return;
        }`;

const after = `        if (!apiKey) {
            if (provider === 'glm') {
                await vscode.commands.executeCommand('codingAgent.setGLMApiKey');
            } else {
                await vscode.commands.executeCommand('codingAgent.setApiKey');
            }
            // Tell the user in the chat why nothing ran, instead of failing
            // silently (this previously looked like the prompt vanished --
            // and meant no API request was ever sent for the provider).
            let conv = this.active();
            if (!conv) conv = await this.createConversation();
            const messages = [...conv.messages, { role: 'user' as const, content: item.text }];
            await this.save(conv.id, [...messages, { role: 'assistant' as const, content: provider === 'glm'
                ? 'No GLM API key is saved, so no request was sent. Run "Coding Agent: Set GLM API Key" (Ctrl+Shift+P), paste a z.ai (international) key, then resend.'
                : 'No DeepSeek API key is saved, so no request was sent. Run "Coding Agent: Set API Key" (Ctrl+Shift+P), paste your key, then resend.' }]);
            this.postState(view);
            return;
        }`;

if (!src.includes(before)) {
    console.error('Pattern not found -- no changes made.');
    process.exit(1);
}
src = src.replace(before, after);
writeFileSync(file, src);
console.log('Patched src/extension.ts: missing-key runs now explain themselves in chat.');
