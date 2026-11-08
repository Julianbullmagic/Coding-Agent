import { execSync } from 'node:child_process';

const msg = 'fix: increase request timeouts and guard null responses';
execSync('git add -A', { stdio: 'inherit' });
execSync(`git commit -m "${msg}"`, { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
console.log('committed and pushed');
