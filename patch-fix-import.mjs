import fs from 'node:fs';

const CRLF = '\r\n';
const raw = fs.readFileSync('src/extension.ts', 'utf8');
const usesCrlf = raw.includes(CRLF);
let s = raw.replace(/\r\n/g, '\n');

const current = `    clearErrorLog,
    classifySource,
    ErrorSource,
} from './self-heal';`;
const fixed = `    clearErrorLog,
    bumpRepairAttempts,
    classifySource,
    ErrorSource,
} from './self-heal';`;

if (s.includes(fixed)) throw new Error('import already fixed');
if (!s.includes(current)) throw new Error('import block not found');
s = s.replace(current, fixed);

fs.writeFileSync('src/extension.ts', usesCrlf ? s.replace(/\n/g, CRLF) : s);
console.log('fixed extension.ts import: restored bumpRepairAttempts');
