import * as vscode from 'vscode';
import { startupFolderPath } from './path-from-argv';

/**
 * Resolve the workspace folder the agent should operate on.
 *
 * Priority:
 *   1. The active text editor's file (most specific "what is the user looking at").
 *   2. The first open workspace folder.
 *   3. VS Code's own `--folder-uri` startup argument (works even before the
 *      workspace finishes loading).
 *
 * It deliberately does NOT fall back to `process.cwd()` or the extension's own
 * install directory, because those point at the VS Code install location and
 * would make the agent read the wrong tree.
 */
export function detectWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri && activeUri.scheme === 'file') {
        const folder = vscode.workspace.getWorkspaceFolder(activeUri);
        if (folder) return folder;
    }

    const first = vscode.workspace.workspaceFolders?.[0];
    if (first) return first;

    const path = startupFolderPath();
    return path ? filePathToWorkspaceFolder(path) : undefined;
}

/**
 * Re-exported so callers can test the startup-argument fallback and build a
 * synthetic WorkspaceFolder from a path without the `vscode` dependency.
 */
export { startupFolderPath } from './path-from-argv';

export function filePathToWorkspaceFolder(path: string): vscode.WorkspaceFolder {
    return {
        uri: vscode.Uri.file(path),
        name: path.split(/[\\/]/).filter(Boolean).pop() || path,
        index: 0,
    };
}
