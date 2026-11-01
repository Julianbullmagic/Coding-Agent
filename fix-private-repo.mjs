import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/backup.ts';
const original = readFileSync(file, 'utf8');

// Replace the private-then-public fallback with private-only.
const find = `        await run(\n            'gh',\n            ['repo', 'create', name, '--source', cwd, '--remote', 'origin', '--private', '--push'],\n            cwd,\n        ).catch(async () => {\n            await run('gh', ['repo', 'create', name, '--source', cwd, '--remote', 'origin', '--public', '--push'], cwd);\n        });`;

const replace = `        await run(\n            'gh',\n            ['repo', 'create', name, '--source', cwd, '--remote', 'origin', '--private', '--push'],\n            cwd,\n        );`;

if (!original.includes(find)) {
    console.error('Anchor not found in backup.ts. Aborting to avoid corruption.');
    process.exit(1);
}

if (original.indexOf(find) !== original.lastIndexOf(find)) {
    console.error('Ambiguous anchor (found more than once). Aborting.');
    process.exit(1);
}

writeFileSync(file, original.replace(find, replace), 'utf8');
console.log('OK: backup.ts now creates repos private-only.');
