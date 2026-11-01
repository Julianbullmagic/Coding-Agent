import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/extension.ts';
let src = readFileSync(file, 'utf8');

function replaceOnce(haystack, needle, replacement, label) {
  const i = haystack.indexOf(needle);
  if (i === -1) {
    throw new Error(`Anchor not found: ${label}`);
  }
  if (haystack.indexOf(needle, i + needle.length) !== -1) {
    throw new Error(`Anchor ambiguous (multiple matches): ${label}`);
  }
  return haystack.slice(0, i) + replacement + haystack.slice(i + needle.length);
}

let original = src;

// 1. On activation, always refresh the status bar (prompt on every reload).
src = replaceOnce(
  src,
  "    if (config.get<boolean>('promptForGitHubLogin', true)) {\n        void githubStatusBar.refresh();\n    }",
  "    // Always refresh on activation so the login prompt fires on every\n    // extension open / VS Code reload while credentials are missing.\n    void githubStatusBar.refresh();",
  'activate refresh gate',
);

// 2. On workspace-folder change, always refresh as well.
src = replaceOnce(
  src,
  "        vscode.workspace.onDidChangeWorkspaceFolders(() => {\n            if (config.get<boolean>('promptForGitHubLogin', true)) {\n                void githubStatusBar.refresh();\n            }\n        }),",
  "        vscode.workspace.onDidChangeWorkspaceFolders(() => {\n            void githubStatusBar.refresh();\n        }),",
  'workspace folders refresh gate',
);

// 3. Flip default of promptForGitHubLogin is left as-is (still honored for nothing now,
//    but keep the setting definition intact). No change needed here.

if (src === original) {
  throw new Error('No changes applied');
}

writeFileSync(file, src);
console.log('Patched src/extension.ts: login prompt now fires on every reload.');
