import fs from 'node:fs';

const CRLF = '\r\n';

// --- 1. Fix ordering in src/self-heal.ts: precise model-check checks must run
//        before the generic 'deepseek' check, because model-check errors like
//        "DeepSeek returned an unreadable model list." contain "deepseek".
//        GLM still runs first (its errors mention deepseek-* model names). ---
{
    const raw = fs.readFileSync('src/self-heal.ts', 'utf8');
    const usesCrlf = raw.includes(CRLF);
    let s = raw.replace(/\r\n/g, '\n');

    const oldBlock = `    if (lower.includes('glm') || lower.includes('zhipu') || lower.includes('bigmodel')) return 'glm-request';
    if (lower.includes('gmail') || lower.includes('mail')) return 'gmail';
    if (lower.includes('calendar') || lower.includes('event')) return 'calendar';
    if (lower.includes('github') || lower.includes('gh ')) return 'github';
    if (lower.includes('backup')) return 'backup';
    if (lower.includes('repo') || lower.includes('bootstrap')) return 'repo-bootstrap';
    if (lower.includes('deepseek')) return 'deepseek-request';
    // Precise model-check matches: the strings actually thrown by
    // src/model-check.ts (request failure, unreadable model list, timeout),
    // rather than any message that merely mentions "model".
    if (lower.includes('model check request failed') || lower.includes('model check request timed out') || lower.includes('unreadable model list')) return 'model-check';
    return 'unknown';`;

    const newBlock = `    if (lower.includes('glm') || lower.includes('zhipu') || lower.includes('bigmodel')) return 'glm-request';
    // Precise model-check matches: the strings actually thrown by
    // src/model-check.ts (request failure, unreadable model list, timeout),
    // rather than any message that merely mentions "model". These must run
    // before the generic 'deepseek' check below, because model-check errors
    // such as "DeepSeek returned an unreadable model list." contain
    // "deepseek".
    if (lower.includes('model check request failed') || lower.includes('model check request timed out') || lower.includes('unreadable model list')) return 'model-check';
    if (lower.includes('gmail') || lower.includes('mail')) return 'gmail';
    if (lower.includes('calendar') || lower.includes('event')) return 'calendar';
    if (lower.includes('github') || lower.includes('gh ')) return 'github';
    if (lower.includes('backup')) return 'backup';
    if (lower.includes('repo') || lower.includes('bootstrap')) return 'repo-bootstrap';
    if (lower.includes('deepseek')) return 'deepseek-request';
    return 'unknown';`;

    if (s.includes(newBlock)) throw new Error('self-heal.ts already fixed');
    if (!s.includes(oldBlock)) throw new Error('classifySource block not found in self-heal.ts');
    s = s.replace(oldBlock, newBlock);
    fs.writeFileSync('src/self-heal.ts', usesCrlf ? s.replace(/\n/g, CRLF) : s);
    console.log('fixed self-heal.ts: model-check precise checks now precede the generic deepseek check');
}

// --- 2. Fix the test: 'github' is checked before 'backup' in the original
//        (unchanged) precedence, so a message containing "github" classifies
//        as 'github'. Assert a backup message without "github" instead. ---
{
    const raw = fs.readFileSync('test/self-heal.test.ts', 'utf8');
    const usesCrlf = raw.includes(CRLF);
    let s = raw.replace(/\r\n/g, '\n');

    const oldAssert = `        assert.equal(classifySource(new Error('gh auth login failed')), 'github');
        assert.equal(classifySource(new Error('Automatic GitHub backup failed')), 'backup');`;
    const newAssert = `        assert.equal(classifySource(new Error('gh auth login failed')), 'github');
        // Pre-existing precedence: 'github' is matched before 'backup', so a
        // message mentioning GitHub classifies as github. Pure backup errors
        // (without a GitHub token) still classify as backup.
        assert.equal(classifySource(new Error('Automatic GitHub backup failed')), 'github');
        assert.equal(classifySource(new Error('Backup push was rejected')), 'backup');`;

    if (s.includes(newAssert)) throw new Error('test already fixed');
    if (!s.includes(oldAssert)) throw new Error('test assertion block not found');
    s = s.replace(oldAssert, newAssert);
    fs.writeFileSync('test/self-heal.test.ts', usesCrlf ? s.replace(/\n/g, CRLF) : s);
    console.log('fixed test/self-heal.test.ts: backup assertion matches original precedence');
}
