import { execSync } from 'child_process';
const run = (c) => { console.log('> ' + c); console.log(execSync(c, { encoding: 'utf8' })); };
run('git add -f coding-agent-extension-0.3.13.vsix');
run('git commit -m "chore(backup): add coding-agent-extension-0.3.13.vsix"');
run('git push');
run('git log --oneline -3');
