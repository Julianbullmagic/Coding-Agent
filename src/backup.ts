import { spawn, spawnSync } from 'child_process';

export interface BackupResult {
    ok: boolean;
    action: 'nothing' | 'committed' | 'pushed' | 'created-repo';
    message: string;
}

function run(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, { cwd, env: process.env, windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
        child.once('error', (error) => reject(error));
        child.once('close', (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error((stderr || stdout).trim() || `${command} exited with code ${code ?? 'unknown'}.`));
        });
    });
}

async function runOrEmpty(command: string, args: string[], cwd: string): Promise<string> {
    try {
        return await run(command, args, cwd);
    } catch {
        return '';
    }
}

export function isGitHubCliInstalled(): boolean {
    const result = spawnSync('gh', ['--version'], { env: process.env, windowsHide: true });
    return result.error === undefined && result.status === 0;
}

export async function isGitHubAuthenticated(cwd: string): Promise<boolean> {
    try {
        await run('gh', ['auth', 'status', '--hostname', 'github.com'], cwd);
        return true;
    } catch {
        return false;
    }
}

async function ensureGitIdentity(cwd: string): Promise<void> {
    const hasName = await runOrEmpty('git', ['config', '--get', 'user.name'], cwd);
    const hasEmail = await runOrEmpty('git', ['config', '--get', 'user.email'], cwd);
    if (hasName && hasEmail) return;

    await run('gh', ['auth', 'setup-git'], cwd);
    const userJson = await run('gh', ['api', 'user'], cwd);
    const user = JSON.parse(userJson) as { login?: string; name?: string; email?: string };
    const login = user.login?.trim();
    const name = user.name?.trim() || login;
    const email = user.email?.trim() || (login ? `${login}@users.noreply.github.com` : undefined);
    if (!name || !email) throw new Error('GitHub did not provide an account name or login.');
    await run('git', ['config', 'user.name', name], cwd);
    await run('git', ['config', 'user.email', email], cwd);
}

async function isGitRepo(cwd: string): Promise<boolean> {
    return (await runOrEmpty('git', ['rev-parse', '--git-dir'], cwd)) !== '';
}

async function currentRemote(cwd: string): Promise<string> {
    return runOrEmpty('git', ['config', '--get', 'remote.origin.url'], cwd);
}

async function hasUncommittedChanges(cwd: string): Promise<boolean> {
    return (await runOrEmpty('git', ['status', '--porcelain'], cwd)).trim() !== '';
}

/**
 * Create a private GitHub repository and wire it up as the workspace's `origin`
 * remote, then push. We deliberately do NOT use `gh repo create --source/
 * --remote/--push` together: those flags are mutually exclusive in ways that
 * differ across `gh` versions and frequently fail with
 * "the `--remote` option can only be used with `--source`". Instead we:
 *
 *   1. create the repo (empty) with `gh repo create <name> --private`,
 *   2. set the `origin` remote from the returned URL (or via `gh repo view`),
 *   3. push with `git push -u origin HEAD`.
 *
 * This avoids the fragile flag combination entirely.
 */
async function createRepoWithRemote(name: string, cwd: string): Promise<string> {
    await run('gh', ['repo', 'create', name, '--private'], cwd);

    // Resolve the remote URL for the newly created repo.
    let originUrl = await runOrEmpty('gh', ['repo', 'view', name, '--json', 'url', '--jq', '.url'], cwd);
    if (!originUrl) {
        // Fall back to the authenticated user's namespace.
        const userJson = await runOrEmpty('gh', ['api', 'user', '--jq', '.login'], cwd);
        const login = userJson.trim();
        if (!login) throw new Error('Could not resolve the new repository URL after creating it.');
        originUrl = `https://github.com/${login}/${name}.git`;
    }

    // Ensure we have a remote "origin" pointing at the new repo, then push.
    if (!(await currentRemote(cwd))) {
        await run('git', ['remote', 'add', 'origin', originUrl], cwd);
    }
    await run('git', ['push', '--set-upstream', 'origin', 'HEAD'], cwd);
    return name;
}

/**
 * Ensures the workspace is a Git repository with a GitHub remote, then commits
 * and pushes all changes. Designed to run silently on an interval (auto-backup).
 */
export async function backupWorkspaceToGitHub(cwd: string, repoName: string): Promise<BackupResult> {
    if (!cwd || !cwd.trim()) {
        return { ok: false, action: 'nothing', message: 'No workspace folder is open; cannot back up.' };
    }

    if (!(await isGitHubAuthenticated(cwd))) {
        return { ok: false, action: 'nothing', message: 'GitHub CLI is not authenticated. Run "Coding Agent: Sign in to GitHub" first.' };
    }

    await ensureGitIdentity(cwd);

    if (!(await isGitRepo(cwd))) {
        await run('git', ['init', '-b', 'main'], cwd);
    }

    if (!(await currentRemote(cwd))) {
        // Commit first so there is a `HEAD` to push when we create the repo.
        if (await hasUncommittedChanges(cwd)) {
            await run('git', ['add', '-A'], cwd);
            try {
                await run('git', ['commit', '-m', `chore(backup): automatic backup ${new Date().toISOString()}`], cwd);
            } catch (error) {
                if (!String(error).toLowerCase().includes('nothing to commit')) throw error;
            }
        }
        const name = repoName.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 100) || 'coding-agent-backup';
        await createRepoWithRemote(name, cwd);
        return { ok: true, action: 'created-repo', message: `Created GitHub repository "${name}" and pushed.` };
    }

    if (!(await hasUncommittedChanges(cwd))) {
        return { ok: true, action: 'nothing', message: 'No changes to back up.' };
    }

    await run('git', ['add', '-A'], cwd);
    try {
        await run('git', ['commit', '-m', `chore(backup): automatic backup ${new Date().toISOString()}`], cwd);
    } catch (error) {
        if (!String(error).toLowerCase().includes('nothing to commit')) throw error;
    }

    await run('git', ['push', '--set-upstream', 'origin', 'HEAD'], cwd);
    return { ok: true, action: 'pushed', message: 'Backed up to GitHub.' };
}
