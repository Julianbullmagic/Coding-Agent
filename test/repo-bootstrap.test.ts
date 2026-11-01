import { strict as assert } from 'assert';
import { slugifyRepoName } from '../src/repo-bootstrap';

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
});
