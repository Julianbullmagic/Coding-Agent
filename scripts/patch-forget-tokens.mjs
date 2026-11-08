import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function patch(absPath, edits) {
  const absolute = join(root, absPath);
  let text = readFileSync(absolute, 'utf8');
  for (const [from, to] of edits) {
    if (!text.includes(from)) {
      throw new Error(`Not found in ${absPath}:\n${from}`);
    }
    if (text.split(from).length - 1 !== 1) {
      throw new Error(`Ambiguous (multiple/none) match in ${absPath}:\n${from}`);
    }
    text = text.replace(from, to);
  }
  writeFileSync(absolute, text, 'utf8');
  console.log(`patched ${absPath}`);
}

// 1) package.json: activation event + contribution
patch('package.json', [
  [
    '    "onCommand:codingAgent.configureGoogleCalendar"',
    '    "onCommand:codingAgent.configureGoogleCalendar",\n    "onCommand:codingAgent.forgetGoogleTokens"',
  ],
  [
    '      {\n        "command": "codingAgent.configureGoogleCalendar",\n        "title": "Coding Agent: Configure Google Calendar"\n      }',
    '      {\n        "command": "codingAgent.configureGoogleCalendar",\n        "title": "Coding Agent: Configure Google Calendar"\n      },\n      {\n        "command": "codingAgent.forgetGoogleTokens",\n        "title": "Coding Agent: Forget Google Tokens"\n      }',
  ],
]);

// 2) extension.ts: register the command handler
patch('src/extension.ts', [
  [
    "    const configureGoogleCalendar = vscode.commands.registerCommand('codingAgent.configureGoogleCalendar', async () => {",
    "    const forgetGoogleTokens = vscode.commands.registerCommand('codingAgent.forgetGoogleTokens', async () => {\n        await context.globalState.update(GOOGLE_TOKENS_SECRET, undefined);\n        await context.globalState.update(GMAIL_TOKENS_SECRET, undefined);\n        void vscode.window.showInformationMessage('Calendar and Gmail authorization cleared. The agent will re-open the browser on next use.');\n    });\n\n    const configureGoogleCalendar = vscode.commands.registerCommand('codingAgent.configureGoogleCalendar', async () => {",
  ],
  [
    "    context.subscriptions.push(\n        setApiKey,\n        configureGoogleCalendar,\n        askDeepSeek,",
    "    context.subscriptions.push(\n        setApiKey,\n        configureGoogleCalendar,\n        forgetGoogleTokens,\n        askDeepSeek,",
  ],
]);

console.log('done');
