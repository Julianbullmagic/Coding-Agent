import { execSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';

execSync('git add -A', { stdio: 'inherit' });
execSync('git commit -m "chore: remove temp script"', { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
console.log('done');
