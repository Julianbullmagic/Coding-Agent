import { strict as assert } from 'assert';
import {
    LOGIN_COMMAND,
    LOGIN_TERMINAL_NAME,
    LOGIN_POLL_INTERVAL_MS,
    LOGIN_POLL_TIMEOUT_MS,
    isBrowserLoginCommand,
    shouldKeepPolling,
    nextPollDelay,
    buildLoginSuccessMessage,
    buildLoginTimeoutWarning,
} from '../src/login-flow';

describe('GitHub login flow helpers', () => {
    it('uses the browser-based gh auth login command', () => {
        // This is the thing that makes the browser open automatically instead of
        // hanging on a captured, non-interactive spawn.
        assert.ok(isBrowserLoginCommand(LOGIN_COMMAND));
        assert.ok(LOGIN_COMMAND.includes('auth login'));
        assert.ok(LOGIN_COMMAND.includes('--web'));
        assert.ok(LOGIN_COMMAND.includes('--hostname github.com'));
        assert.ok(LOGIN_COMMAND.includes('--git-protocol https'));
    });

    it('names the sign-in terminal for the user', () => {
        assert.equal(LOGIN_TERMINAL_NAME, 'GitHub Sign In');
    });

    it('polls on a sane interval and timeout', () => {
        assert.ok(LOGIN_POLL_INTERVAL_MS > 0);
        assert.ok(LOGIN_POLL_TIMEOUT_MS > LOGIN_POLL_INTERVAL_MS);
        assert.equal(LOGIN_POLL_TIMEOUT_MS, 5 * 60 * 1000);
    });

    it('keeps polling until the timeout is reached', () => {
        const started = 1_000;
        const timeout = LOGIN_POLL_TIMEOUT_MS;
        assert.equal(shouldKeepPolling(started, started + timeout - 1, timeout), true);
        assert.equal(shouldKeepPolling(started, started + timeout, timeout), false);
        assert.equal(shouldKeepPolling(started, started + timeout + 1, timeout), false);
    });

    it('never polls with a non-positive timeout', () => {
        assert.equal(shouldKeepPolling(0, 0, 0), false);
        assert.equal(shouldKeepPolling(0, 100, -1), false);
    });

    it('clamps the poll delay to a positive integer', () => {
        assert.equal(nextPollDelay(3000), 3000);
        assert.equal(nextPollDelay(0.5), 1);
        assert.equal(nextPollDelay(-7), 1);
    });

    it('produces a user-facing success message', () => {
        assert.ok(buildLoginSuccessMessage().includes('Signed in to GitHub'));
    });

    it('produces a user-facing timeout warning that mentions the terminal', () => {
        assert.ok(buildLoginTimeoutWarning().includes('GitHub Sign In'));
        assert.ok(buildLoginTimeoutWarning().includes('browser'));
    });
});
