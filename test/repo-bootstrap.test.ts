import { strict as assert } from 'assert';
import { slugifyRepoName, isRepoNameCollision, nextCollisionName } from '../src/repo-bootstrap';

describe('Repo bootstrap helpers', () => {
    it('slugifies a simple folder name', () => {
        assert.equal(slugifyRepoName('My Project'), 'my-project');
    });

    it('lowercases and replaces spaces with dashes', () => {
        assert.equal(slugifyRepoName('Hello World'), 'hello-world');
    });

    it('keeps dots, dashes, and underscores', () => {
        assert.equal(slugifyRepoName('My.Repo_Name'), 'my.repo_name');
    });

    it('strips invalid characters', () => {
        assert.equal(slugifyRepoName('Bad !!! Name @#'), 'bad-name');
    });

    it('collapses repeated dashes', () => {
        assert.equal(slugifyRepoName('a --- b'), 'a-b');
    });

    it('trims leading/trailing separators', () => {
        assert.equal(slugifyRepoName('--hello--'), 'hello');
    });

    it('falls back to a default when everything is invalid', () => {
        assert.equal(slugifyRepoName('!!!'), 'coding-agent-project');
    });

    it('handles an empty string', () => {
        assert.equal(slugifyRepoName(''), 'coding-agent-project');
    });

    it('detects a GitHub name-collision error message', () => {
        assert.equal(isRepoNameCollision(new Error('name already exists on this account')), true);
        assert.equal(isRepoNameCollision(new Error('https://github.com/foo/bar already exists')), true);
        assert.equal(isRepoNameCollision(new Error('repository creation failed for another reason')), false);
    });

    it('generates deterministic collision suffixes', () => {
        assert.equal(nextCollisionName('my-repo', 2), 'my-repo-2');
        assert.equal(nextCollisionName('my-repo', 3), 'my-repo-3');
        assert.equal(nextCollisionName('my-repo', 7), 'my-repo-7');
    });
});
