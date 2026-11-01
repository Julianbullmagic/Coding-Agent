import { strict as assert } from 'assert';
import { checkGitHubAuth, isGitHubCliInstalled } from '../src/github-auth';

describe('GitHub auth helpers', () => {
    it('isGitHubCliInstalled returns a boolean', () => {
        assert.equal(typeof isGitHubCliInstalled(), 'boolean');
    });

    it('checkGitHubAuth returns a well-formed auth status', async () => {
        const status = await checkGitHubAuth(process.cwd());
        assert.ok(typeof status.state === 'string');
        // One of the four known states.
        assert.ok(
            ['installed', 'not-authenticated', 'not-installed', 'error'].includes(status.state),
        );
        if (status.state === 'installed') {
            assert.equal(typeof status.login, 'string');
        }
        if (status.state === 'not-authenticated') {
            assert.ok(status.reason === 'missing' || status.reason === 'expired');
        }
    }).timeout(10000);
});
