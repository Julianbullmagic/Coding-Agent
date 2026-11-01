import { spawnSync } from 'node:child_process';

const msg = 'fix: scope workspace access and conversation state per folder';

const add = spawnSync('git', ['add', '-A'], { stdio: 'inherit' });
if (add.status !== 0) { console.error('add failed', add.status); process.exit(1); }

const commit = spawnSync('git', ['commit', '-m', msg], { stdio: 'inherit' });
if (commit.status !== 0) { console.error('commit failed', commit.status); process.exit(1); }

const push = spawnSync('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
if (push.status !== 0) { console.error('push failed', push.status); process.exit(1); }

console.log('OK');
