import * as vscode from 'vscode';
import { checkGitHubAuth, GitHubAuthStatus } from './github-auth';

export type { GitHubAuthStatus } from './github-auth';

export type StatusBarController = {
    dispose(): void;
    refresh(): Promise<void>;
};

/**
 * Manages a status-bar indicator that shows the current GitHub login state, and
 * (when credentials are missing, expired, or unverifiable) prompts the user to sign in.
 */
export function createGitHubStatusBar(): StatusBarController {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.command = 'codingAgent.loginGitHub';
    item.tooltip = 'Click to sign in to GitHub';
    item.show();

    let prompting = false;

    const setState = (status: GitHubAuthStatus): void => {
        switch (status.state) {
            case 'installed':
                item.text = `$(github) GitHub: ${status.login || 'Signed in'}`;
                item.tooltip = 'Signed in to GitHub as ' + (status.login || 'unknown');
                break;
            case 'not-installed':
                item.text = '$(github) GitHub: CLI not installed';
                item.tooltip = 'GitHub CLI (gh) is not installed. Click for details.';
                break;
            case 'not-authenticated':
                item.text = status.reason === 'expired'
                    ? '$(github) GitHub: sign-in expired'
                    : '$(github) GitHub: Not signed in';
                item.tooltip = status.reason === 'expired'
                    ? 'Your GitHub credentials have expired. Click to sign in again.'
                    : 'Sign in to GitHub to enable backups and repository tools.';
                break;
            case 'error':
                item.text = '$(github) GitHub: error';
                item.tooltip = status.message;
                break;
        }
    };

    const promptIfNeeded = async (status: GitHubAuthStatus): Promise<void> => {
        // Prompt whenever there are no valid credentials, including when the
        // GitHub CLI itself is missing or the auth state cannot be verified.
        if (status.state === 'installed') return;
        if (prompting) return;
        prompting = true;
        try {
            let label: string;
            if (status.state === 'not-installed') {
                label = 'GitHub CLI (gh) is not installed, which is required for GitHub backups.';
            } else if (status.state === 'not-authenticated') {
                label = status.reason === 'expired'
                    ? 'Your GitHub credentials have expired.'
                    : 'Sign in to GitHub to enable automatic backups and repository tools.';
            } else {
                label = 'GitHub authentication could not be checked.';
            }
            const choice = await vscode.window.showWarningMessage(
                `${label} Sign in now?`,
                'Sign in to GitHub',
                'Not now',
            );
            if (choice === 'Sign in to GitHub') {
                await vscode.commands.executeCommand('codingAgent.loginGitHub');
            }
        } finally {
            prompting = false;
        }
    };

    const refresh = async (): Promise<void> => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const status = await checkGitHubAuth(cwd);
        setState(status);
        await promptIfNeeded(status);
    };

    return {
        dispose(): void {
            item.dispose();
        },
        refresh,
    };
}
