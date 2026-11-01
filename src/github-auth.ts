import { spawn, spawnSync } from 'child_process';

export type GitHubAuthStatus =
    | { state: 'installed'; login: string }
    | { state: 'not-authenticated'; reason: 'missing' | 'expired' }
    | { state: 'not-installed' }
    | { state: 'error'; message: string };

function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env: process.env, windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
        child.once('error', (error) => reject(error));
        child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
}

export function isGitHubCliInstalled(): boolean {
    const result = spawnSync('gh', ['--version'], { env: process.env, windowsHide: true });
    return result.error === undefined && result.status === 0;
}

/**
 * Determines whether the GitHub CLI is installed and authenticated, and whether
 * the stored credentials are still valid (an expired/revoked token causes
 * `gh auth status` to exit non-zero).
 *
 * This module intentionally has no `vscode` dependency so it can be unit-tested
 * in plain Node.
 */
export async function checkGitHubAuth(cwd: string): Promise<GitHubAuthStatus> {
    if (!isGitHubCliInstalled()) {
        return { state: 'not-installed' };
    }

    try {
        const status = await run('gh', ['auth', 'status', '--hostname', 'github.com'], cwd);
        if (status.code !== 0) {
            return await classifyAuthFailure(cwd);
        }
        const login = await currentLogin(cwd);
        return { state: 'installed', login };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { state: 'error', message };
    }
}

async function classifyAuthFailure(cwd: string): Promise<GitHubAuthStatus> {
    // `gh auth token` prints the token if one is stored, and fails if none exists.
    try {
        const token = await run('gh', ['auth', 'token', '--hostname', 'github.com'], cwd);
        if (token.code === 0 && token.stdout.trim().length > 0) {
            // A token is stored but `gh auth status` rejected it => expired/revoked.
            return { state: 'not-authenticated', reason: 'expired' };
        }
        return { state: 'not-authenticated', reason: 'missing' };
    } catch {
        return { state: 'not-authenticated', reason: 'missing' };
    }
}

async function currentLogin(cwd: string): Promise<string> {
    try {
        const api = await run('gh', ['api', 'user', '--jq', '.login'], cwd);
        return (api.stdout || '').trim();
    } catch {
        return '';
    }
}
