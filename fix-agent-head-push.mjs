import { readFile, writeFile } from 'fs/promises';

const file = 'src/agent.ts';
let text = await readFile(file, 'utf8');

// Helper: guard push HEAD with an empty commit when the branch is unborn.
const helper = `
// Pushing HEAD from a repository with no commits fails with
// "error: src refspec HEAD does not match any" because HEAD is unborn.
// Mirror of ensureHeadForPush in src/repo-bootstrap.ts: make an empty commit
// so the push always succeeds.
async function ensureHeadForPush(workspacePath: string): Promise<void> {
    let hasCommits = '';
    try {
        hasCommits = await runProcess('git', ['rev-parse', '--verify', 'HEAD'], workspacePath);
    } catch {
        hasCommits = '';
    }
    if (!hasCommits.trim()) {
        await runProcess('git', ['commit', '--allow-empty', '-m', 'Initial commit'], workspacePath);
    }
}
`;

if (!text.includes('async function ensureHeadForPush')) {
    text = text.replace(
        'async function createGitHubRepository(',
        helper + '\nasync function createGitHubRepository(',
    );
}

// createGitHubRepository: ensure a commit exists before pushing HEAD.
if (!text.includes('ensureHeadForPush(workspacePath);\n    await runProcess(\'git\', [\'push\', \'--set-upstream\', \'origin\', \'HEAD\'], workspacePath);')) {
    text = text.replace(
        "    await runProcess('git', ['push', '--set-upstream', 'origin', 'HEAD'], workspacePath);\n    return name;",
        "    // Pushing HEAD from an unborn branch fails with \"src refspec HEAD does\n    // not match any\"; make an empty commit first if needed.\n    await ensureHeadForPush(workspacePath);\n    await runProcess('git', ['push', '--set-upstream', 'origin', 'HEAD'], workspacePath);\n    return name;",
    );
}

// commitAndPush: same guard when no explicit branch was given.
if (!text.includes('else branchArgs.push(\'HEAD\');\n    await ensureHeadForPush')) {
    text = text.replace(
        "    else branchArgs.push('HEAD');\n    const pushOutput = await runProcess('git', branchArgs, workspacePath);",
        "    else {\n        branchArgs.push('HEAD');\n        // Guard against \"src refspec HEAD does not match any\" on an unborn branch.\n        await ensureHeadForPush(workspacePath);\n    }\n    const pushOutput = await runProcess('git', branchArgs, workspacePath);",
    );
}

await writeFile(file, text);
console.log('patched', file);
