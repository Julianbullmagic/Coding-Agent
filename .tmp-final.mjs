import { execSync } from 'node:child_process';
execSync('git add -A', { stdio: 'inherit' });
execSync('git commit -m "chore: remove temp script"', { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
console.log('done');
