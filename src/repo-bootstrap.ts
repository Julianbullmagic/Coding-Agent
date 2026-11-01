import { spawn } from 'child_process';

export type BootstrapResult = {
    action: 'no-workspace' | 'not-authenticated' | 'existing-repo' | 'created-repo' | 'error';
    message: string;
};

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

async function isGitAuthenticated(cwd: string): Promise<boolean> {
    try {
        await run('gh', ['auth', 'status', '--hostname', 'github.com'], cwd);
        return true;
    } catch {
        return false;
    }
}

async function isGitRepo(cwd: string): Promise<boolean> {
    return (await runOrEmpty('git', ['rev-parse', '--git-dir'], cwd)) !== '';
}

async function currentRemote(cwd: string): Promise<string> {
    return runOrEmpty('git', ['config', '--get', 'remote.origin.url'], cwd);
}

async function hasCommits(cwd: string): Promise<boolean> {
    return (await runOrEmpty('git', ['rev-parse', '--verify', 'HEAD'], cwd)) !== '';
}

async function currentBranch(cwd: string): Promise<string> {
    return runOrEmpty('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

/**
 * Slugify a folder name into a valid GitHub repository name.
 */
export function slugifyRepoName(name: string): string {
    const cleaned = name
        .toLowerCase()
        .replace(/[^a-z0-9-_.]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '');
    return cleaned || 'coding-agent-project';
}

/**
 * True when the GitHub CLI reported that a repository name is already taken.
 * gh prints messages like "name already exists on this account" or a URL with
 * "already exists" and exits non-zero.
 */
export function isRepoNameCollision(error: unknown): boolean {
    const message = String(error).toLowerCase();
    return message.includes('already exists') || message.includes('name already exists');
}

/**
 * Deterministically generate the next candidate name on a collision, e.g.
 * "my-repo" -> "my-repo-2" -> "my-repo-3" ...
 */
export function nextCollisionName(base: string, attempt: number): string {
    return `${base}-${attempt}`;
}

async function ghCreateRepo(name: string, cwd: string): Promise<void> {
    await run(
        'gh',
        ['repo', 'create', name, '--source', cwd, '--remote', 'origin', '--private', '--push'],
        cwd,
    );
}

/**
 * Create a private GitHub repository, retrying with a numeric suffix when the
 * base name is already taken. After several failures, it hands control back to
 * the caller which may prompt the user for an explicit name.
 */
export async function createRepoWithRetry(
    base: string,
    cwd: string,
    maxAttempts = 5,
): Promise<{ name: string; branch: string }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const name = attempt === 1 ? base : nextCollisionName(base, attempt);
        try {
            await ghCreateRepo(name, cwd);
            const branch = (await currentBranch(cwd)) || 'main';
            return { name, branch };
        } catch (error) {
            lastError = error;
            if (!isRepoNameCollision(error)) throw error;
        }
    }
    throw new Error(`Repository name "${base}" is already taken: ${String(lastError)}`);
}

/**
 * Ensure the workspace folder is a Git repository hosted on GitHub.
 *
 * Detects the "no repo" state (no `.git`, or `.git` but no `origin` remote) and
 * repairs it automatically by creating a *private* GitHub repository and pushing.
 *
 * This runs once on extension activate so that any opened project that is not
 * yet backed by GitHub gets one without any manual steps.
 */
export async function ensureRepoOnOpen(cwd: string, folderName: string): Promise<BootstrapResult> {
    if (!(await isGitAuthenticated(cwd))) {
        return { action: 'not-authenticated', message: 'GitHub CLI is not authenticated; skipping repo bootstrap.' };
    }

    // Already a git repo with an origin remote: nothing to do.
    if ((await isGitRepo(cwd)) && (await currentRemote(cwd)) !== '') {
        return { action: 'existing-repo', message: 'Workspace already has a GitHub remote.' };
    }

    const name = slugifyRepoName(folderName);

    if (!(await isGitRepo(cwd))) {
        await run('git', ['init', '-b', 'main'], cwd);
    }

    // Create the repo as *private* (never fall back to public).
    // If there are no commits yet, push an empty first commit so GitHub
    // accepts `--push`; otherwise push the existing history.
    if (!(await hasCommits(cwd))) {
        await run('git', ['add', '-A'], cwd);
        try {
            await run('git', ['commit', '-m', 'Initial commit'], cwd);
        } catch (error) {
            if (!String(error).toLowerCase().includes('nothing to commit')) throw error;
        }
    }

    const { name: createdName, branch } = await createRepoWithRetry(name, cwd);

    return {
        action: 'created-repo',
        message: `Created private repository "${createdName}" and pushed ${branch} to GitHub.`,
    };
}
