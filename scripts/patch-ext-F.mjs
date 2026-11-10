import { readFileSync, writeFileSync } from 'fs';
let s = readFileSync('src/extension.ts', 'utf8');

function replaceOnce(needle, replacement, label) {
  if (!s.includes(needle)) throw new Error('NOT FOUND: ' + label);
  const count = s.split(needle).length - 1;
  if (count !== 1) throw new Error('EXPECTED 1 of ' + label + ', got ' + count);
  s = s.replace(needle, replacement);
  console.log('OK', label);
}

// 1. CSS: adjust grid rows and add modelbar styles
replaceOnce(
  `.chat{min-width:0;height:100%}.chat.active{display:grid!important;grid-template-rows:minmax(0,1fr) auto}`,
  `.chat{min-width:0;height:100%}.chat.active{display:grid!important;grid-template-rows:auto minmax(0,1fr) auto}.modelbar{display:flex;gap:6px;padding:8px 10px 0}.modelbtn{flex:1;height:28px;padding:0 8px;border-radius:4px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);cursor:pointer}.modelbtn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:var(--vscode-button-background)}.modelbtn:disabled{opacity:.55;cursor:default}`,
  'css modelbar'
);

// 2. HTML: insert modelbar into chat panel
replaceOnce(
  `<main class="panel chat active" id="chatPanel"><div class="messages" id="messages"></div>`,
  `<main class="panel chat active" id="chatPanel"><div class="modelbar"><button class="modelbtn" id="modelDeepseek">DeepSeek</button><button class="modelbtn" id="modelKimi">Kimi</button></div><div class="messages" id="messages"></div>`,
  'html modelbar'
);

writeFileSync('src/extension.ts', s, 'utf8');
console.log('DONE F, length', s.length);
