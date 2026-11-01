/**
 * Pure, unit-testable pieces of the GitHub sign-in flow.
 *
 * These helpers capture the *decisions* the login command makes, so they can be
 * asserted in plain-Node tests without depending on the VS Code API. The
 * `codingAgent.loginGitHub` command itself stays a thin glue layer over
 * `vscode.window.createTerminal` and the poll loop.
 */

/** The command we send to the visible terminal. It opens the browser and prints
 * a one-time device code, so the user never has to hand-type anything. */
export const LOGIN_COMMAND = 'gh auth login --hostname github.com --git-protocol https --web';

/** Name of the terminal surfaced to the user. */
export const LOGIN_TERMINAL_NAME = 'GitHub Sign In';

/** Poll interval (ms) while waiting for the browser flow to complete. */
export const LOGIN_POLL_INTERVAL_MS = 3000;

/** Total time (ms) we wait before giving up and asking the user to finish manually. */
export const LOGIN_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** True when a `gh auth login --web`-style command opts into the browser flow. */
export function isBrowserLoginCommand(command: string): boolean {
    return command.includes('auth login') && command.includes('--web');
}

/** Decides whether polling should continue given elapsed time and a max timeout. */
export function shouldKeepPolling(startedAtMs: number, nowMs: number, timeoutMs = LOGIN_POLL_TIMEOUT_MS): boolean {
    if (timeoutMs <= 0) return false;
    return nowMs - startedAtMs < timeoutMs;
}

/** Computes the delay (ms) until the next poll tick, clamped to a sane minimum. */
export function nextPollDelay(intervalMs = LOGIN_POLL_INTERVAL_MS): number {
    return Math.max(1, Math.floor(intervalMs));
}

/** Builds the success message shown once auth is detected. */
export function buildLoginSuccessMessage(): string {
    return 'Signed in to GitHub and configured Git authentication.';
}

/** Builds the timeout warning shown when the browser flow is still pending. */
export function buildLoginTimeoutWarning(): string {
    return 'GitHub sign-in is still in progress in the "GitHub Sign In" terminal. ' +
        'Finish the browser flow, then the status bar will update automatically.';
}
