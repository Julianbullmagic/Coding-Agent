import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/extension.ts', 'utf8');

function replaceOnce(needle, replacement, label) {
  if (!s.includes(needle)) throw new Error('NOT FOUND: ' + label);
  const count = s.split(needle).length - 1;
  if (count !== 1) throw new Error('EXPECTED 1 of ' + label + ', got ' + count);
  s = s.replace(needle, replacement);
  console.log('OK', label);
}

// Update onDidReceiveMessage handler to type provider and handle setProvider/setKimiKey
replaceOnce(
  `        view.webview.onDidReceiveMessage(async (message: { type: string; id?: string; text?: string }) => {
            if (message.type === 'ready') {
                this.postState(view);
            } else if (message.type === 'new') {
                await this.createConversation();
                this.postState(view);
            } else if (message.type === 'open' && message.id) {
                await this.context.workspaceState.update('codingAgent.activeConversation', message.id);
                this.postState(view);
            } else if (message.type === 'delete' && message.id) {
                await this.deleteConversation(message.id);
                this.postState(view);
            } else if (message.type === 'send' && message.text?.trim()) {
                await this.send(view, message.text.trim());
            } else if (message.type === 'setApiKey') {
                await vscode.commands.executeCommand('codingAgent.setApiKey');
                this.postState(view);
            }
        });`,
  `        view.webview.onDidReceiveMessage(async (message: { type: string; id?: string; text?: string; provider?: string }) => {
            if (message.type === 'ready') {
                this.postState(view);
            } else if (message.type === 'new') {
                await this.createConversation();
                this.postState(view);
            } else if (message.type === 'open' && message.id) {
                await this.context.workspaceState.update('codingAgent.activeConversation', message.id);
                this.postState(view);
            } else if (message.type === 'delete' && message.id) {
                await this.deleteConversation(message.id);
                this.postState(view);
            } else if (message.type === 'send' && message.text?.trim()) {
                await this.send(view, message.text.trim());
            } else if (message.type === 'setApiKey') {
                await vscode.commands.executeCommand('codingAgent.setApiKey');
                this.postState(view);
            } else if (message.type === 'setProvider' && message.provider) {
                await this.setProvider(message.provider);
                this.postState(view);
            } else if (message.type === 'setKimiKey') {
                await vscode.commands.executeCommand('codingAgent.setKimiApiKey');
                this.postState(view);
            }
        });`,
  'message handler'
);

writeFileSync('src/extension.ts', s, 'utf8');
console.log('DONE C, length', s.length);
