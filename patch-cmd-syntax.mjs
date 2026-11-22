#!/usr/bin/env node
/**
 * Fix: "My shell is malfunctioning (every command echoes back with
 * 'syntax is incorrect' instead of running)".
 *
 * Root cause: on Windows, runShellCommand passes the agent's command verbatim
 * to `cmd.exe /d /s /c`. When the agent emits a multi-line command (common:
 * lines separated by \n), cmd.exe rejects it with
 * "The syntax of the command is incorrect." and the raw error text gives the
 * agent no hint that it is talking to Windows cmd, so it concludes the shell
 * is broken and stops trying to build.
 *
 * Fix:
 * 1. Normalize newlines in the command to ` & ` on Windows (cmd's command
 *    separator), so multi-line commands run as a chain instead of failing.
 * 2. Detect cmd's "syntax of the command is incorrect" error and rewrite it
 *    into a clear, actionable message telling the agent it is on Windows
 *    cmd.exe and how to adapt, instead of a cryptic one-liner.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const target = join(root, 'src', 'agent.ts');
let source = readFileSync(target, 'utf8');

// ---------------------------------------------------------------------------
// 1. Normalize multi-line commands for cmd.exe
// ---------------------------------------------------------------------------
const spawnAnchor = `        const isWindows = process.platform === 'win32';
        const child = spawn(
            isWindows ? 'cmd.exe' : '/bin/sh',
            isWindows ? ['/d', '/s', '/c', command] : ['-c', command],`;

const spawnReplacement = `        const isWindows = process.platform === 'win32';
        // cmd.exe cannot execute commands containing literal newlines and
        // rejects the whole invocation with "The syntax of the command is
        // incorrect." Convert multi-line commands into a single line joined
        // with " & " (cmd's command separator) so chained lines still run.
        const shellCommand = isWindows
            ? command.replace(/\\r?\\n/g, ' & ')
            : command;
        const child = spawn(
            isWindows ? 'cmd.exe' : '/bin/sh',
            isWindows ? ['/d', '/s', '/c', shellCommand] : ['-c', shellCommand],`;

if (!source.includes(spawnAnchor)) {
    console.error('FAIL: runShellCommand spawn anchor not found.');
    process.exit(1);
}
source = source.replace(spawnAnchor, spawnReplacement);

// ---------------------------------------------------------------------------
// 2. Rewrite cmd's cryptic syntax error into an actionable message
// ---------------------------------------------------------------------------
const closeAnchor = `            const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\\n');
            if (timedOut) reject(new Error(\`Command timed out after \${normalized} ms.\`));
            else if (code === 0) resolve(combined || 'Command completed with no output.');
            else reject(new Error(combined || \`Command exited with code \${code ?? 'unknown'}.\`));`;

const closeReplacement = `            const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\\n');
            if (timedOut) reject(new Error(\`Command timed out after \${normalized} ms.\`));
            else if (code === 0) resolve(combined || 'Command completed with no output.');
            else if (/syntax of the command is incorrect/i.test(combined)) {
                reject(new Error([
                    combined,
                    '',
                    'Diagnosis: the shell is Windows cmd.exe (not bash). It rejected the command as written.',
                    'Fix: use cmd-compatible syntax on a single line. Common pitfalls: use "dir" not "ls",',
                    '"type" not "cat", "\\\\" path separators, "&&" to chain commands, and quote the whole',
                    'command carefully (cmd strips quotes differently than bash).',
                ].join('\\n')));
            }
            else reject(new Error(combined || \`Command exited with code \${code ?? 'unknown'}.\`));`;

if (!source.includes(closeAnchor)) {
    console.error('FAIL: runShellCommand close anchor not found.');
    process.exit(1);
}
source = source.replace(closeAnchor, closeReplacement);

writeFileSync(target, source, 'utf8');
console.log('OK: patched src/agent.ts (Windows cmd multi-line + syntax-error diagnosis).');
