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
  `        void view.webview.postMessage({ type: 'state', conversations: this.conversations(), activeId: activeConversation.id, loading });`,
  `        void view.webview.postMessage({
            type: 'state',
            conversations: this.conversations(),
            activeId: activeConversation.id,
            loading,
            provider: this.currentProvider(),
            model: this.agent.getModel(),
        });`,
  'postState provider'
);

writeFileSync('src/extension.ts', s, 'utf8');
console.log('DONE E, length', s.length);
