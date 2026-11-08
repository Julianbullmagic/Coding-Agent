import { execSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';

execSync('git rm .tmp-commit.mjs', { stdio: 'inherit' });
unlinkSync('.tmp-commit.mjs').catch || null;
// git rm already staged removal
execSync('git commit -m "chore: remove temporary commit helper"', { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
console.log('done');
