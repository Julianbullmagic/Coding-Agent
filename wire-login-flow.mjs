import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/extension.ts';
let s = readFileSync(path, 'utf8');

function replaceOnce(anchor, replacement) {
    const count = s.split(anchor).length - 1;
    if (count !== 1) throw new Error(`Anchor not found exactly once (found ${count}): ${anchor}`);
    s = s.replace(anchor, replacement);
}

// 1. Add the import.
replaceOnce(
    "import { backupWorkspaceToGitHub, isGitHubCliInstalled, isGitHubAuthenticated } from './backup';",
    "import { backupWorkspaceToGitHub, isGitHubCliInstalled, isGitHubAuthenticated } from './backup';\nimport { LOGIN_COMMAND, LOGIN_TERMINAL_NAME, LOGIN_POLL_INTERVAL_MS, LOGIN_POLL_TIMEOUT_MS, shouldKeepPolling, nextPollDelay, buildLoginSuccessMessage, buildLoginTimeoutWarning } from './login-flow';",
);

// 2. Use LOGIN_TERMINAL_NAME.
replaceOnce(
    "name: 'GitHub Sign In',",
    'name: LOGIN_TERMINAL_NAME,',
);

// 3. Use LOGIN_COMMAND.
replaceOnce(
    "terminal.sendText('gh auth login --hostname github.com --git-protocol https --web');",
    'terminal.sendText(LOGIN_COMMAND);',
);

// 4. Use timeout constants + shouldKeepPolling.
replaceOnce(
    'const timeoutMs = 5 * 60 * 1000;',
    'const timeoutMs = LOGIN_POLL_TIMEOUT_MS;',
);
replaceOnce(
    'if (Date.now() - started > timeoutMs) {',
    'if (!shouldKeepPolling(started, Date.now(), timeoutMs)) {',
);
replaceOnce(
    "                    'GitHub sign-in is still in progress in the \"GitHub Sign In\" terminal. ' +\n                    'Finish the browser flow, then the status bar will update automatically.',",
    '                    buildLoginTimeoutWarning(),',
);

// 5. Use success message + poll delay.
replaceOnce(
    "                    'Signed in to GitHub and configured Git authentication.',",
    '                    buildLoginSuccessMessage(),',
);
replaceOnce(
    '            setTimeout(() => { void poll(); }, 3000);',
    '            setTimeout(() => { void poll(); }, nextPollDelay(LOGIN_POLL_INTERVAL_MS));',
);

writeFileSync(path, s);
console.log('wired login-flow helpers into src/extension.ts');
