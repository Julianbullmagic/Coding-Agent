import fs from 'fs';

const files = ['src/agent.ts', 'src/extension.ts', 'src/tools/index.ts', 'package.json', 'src/gmail.ts', 'src/extension.ts'];
const pattern = /calendar/i;

for (const f of files) {
    if (!fs.existsSync(f)) { console.log(f + ': MISSING'); continue; }
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
        if (pattern.test(l)) console.log(`${f}:${i + 1}: ${l.trim()}`);
    });
}
