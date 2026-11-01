import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/extension.ts';
let src = readFileSync(file, 'utf8');

// 1. Add the import after the backup import line.
const importAnchor = "import { backupWorkspaceToGitHub, isGitHubCliInstalled, isGitHubAuthenticated } from './backup';";
if (!src.includes(importAnchor)) {
    console.error('Import anchor not found.');
    process.exit(1);
}
if (src.indexOf(importAnchor) !== src.lastIndexOf(importAnchor)) {
    console.error('Import anchor ambiguous.');
    process.exit(1);
}
src = src.replace(
    importAnchor,
    importAnchor + "\nimport { ensureRepoOnOpen, slugifyRepoName } from './repo-bootstrap';",
);

// 2. Insert the ensureRepoOnOpen call inside activate(), right after the agent line.
const agentAnchor = "const agent = new CodingAgent(config.get<string>('model', 'deepseek-v4-pro'));";
if (!src.includes(agentAnchor)) {
    console.error('Agent anchor not found.');
    process.exit(1);
}
if (src.indexOf(agentAnchor) !== src.lastIndexOf(agentAnchor)) {
    console.error('Agent anchor ambiguous.');
    process.exit(1);
}

const bootstrapCall = [
    '',
    "    void (async () => {",
    "        const folder = vscode.workspace.workspaceFolders?.[0];",
    "        if (!folder) return;",
    "        try {",
    "            const result = await ensureRepoOnOpen(folder.uri.fsPath, folder.name);",
    "            if (result.action === 'created-repo') {",
    "                void vscode.window.showInformationMessage(result.message);",
    "            }",
    "        } catch (error) {",
    "            const detail = error instanceof Error ? error.message : 'Unknown repo bootstrap error';",
    "            void vscode.window.showWarningMessage('GitHub repo bootstrap failed: ' + detail);",
    "        }",
    "    })();",
    "",
].join('\n');

src = src.replace(agentAnchor, agentAnchor + "\n" + bootstrapCall);

writeFileSync(file, src, 'utf8');
console.log('OK: extension.ts wired with ensureRepoOnOpen on activate.');
