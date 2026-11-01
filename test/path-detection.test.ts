import { strict as assert } from 'assert';
import { startupFolderPath } from '../src/path-from-argv';

describe('startupFolderPath', () => {
    it('parses a --folder-uri argument with a file URI', () => {
        const path = startupFolderPath(['code', '--folder-uri', 'file:///home/user/project']);
        assert.ok(path?.endsWith('project'));
    });

    it('parses the --folder-uri=value form', () => {
        const path = startupFolderPath(['code', '--folder-uri=file:///home/user/project']);
        assert.ok(path?.endsWith('project'));
    });

    it('returns undefined when no folder argument is present', () => {
        assert.equal(startupFolderPath(['code', '.']), undefined);
        assert.equal(startupFolderPath([]), undefined);
    });

    it('strips the file:// scheme and decodes the path', () => {
        assert.equal(startupFolderPath(['code', '--folder-uri', 'file:///home/user/my%20app']), '/home/user/my app');
    });
});
