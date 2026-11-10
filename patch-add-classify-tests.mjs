import fs from 'node:fs';

const CRLF = '\r\n';
const raw = fs.readFileSync('test/self-heal.test.ts', 'utf8');
const usesCrlf = raw.includes(CRLF);
let s = raw.replace(/\r\n/g, '\n');

if (s.includes("classifySource")) throw new Error('test already patched');

const importMarker = `    bumpRepairAttempts,
} from '../src/self-heal';`;
if (!s.includes(importMarker)) throw new Error('import marker not found in self-heal.test.ts');
s = s.replace(importMarker, `    bumpRepairAttempts,
    classifySource,
} from '../src/self-heal';`);

// Append the new describe block at the end of the file.
const appended = `
describe('classifySource', () => {
    it('classifies the recorded GLM model-name error as glm-request, not model-check', () => {
        // Exact message shape recorded by the self-heal log on 2026-11-10:
        // "The supported API model names are deepseek-flash, deepseek-v4-pro,
        //  but you passed glm-5.3." It contains "model", so a naive
        // includes('model') check misfiles it as model-check.
        const err = new Error(
            'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed glm-5.3. (request_id: 1b6e5621-d14d-4891-ad0d-06223d3382c5)',
        );
        assert.equal(classifySource(err), 'glm-request');
    });

    it('classifies prefixed GLM request failures as glm-request', () => {
        assert.equal(classifySource(new Error('GLM request failed: something went wrong')), 'glm-request');
        assert.equal(classifySource(new Error('zhipu balance exhausted')), 'glm-request');
    });

    it('still classifies real model-check errors as model-check', () => {
        assert.equal(classifySource(new Error('Model check request failed: HTTP 500')), 'model-check');
        assert.equal(classifySource(new Error('Model check request timed out.')), 'model-check');
        assert.equal(classifySource(new Error('DeepSeek returned an unreadable model list.')), 'model-check');
    });

    it('does not classify ordinary model mentions as model-check', () => {
        assert.equal(classifySource(new Error('Unknown model foo')), 'unknown');
    });

    it('classifies other sources unchanged', () => {
        assert.equal(classifySource(new Error('Gmail authorization failed')), 'gmail');
        assert.equal(classifySource(new Error('gh auth login failed')), 'github');
        assert.equal(classifySource(new Error('Automatic GitHub backup failed')), 'backup');
    });
});
`;

s = s.trimEnd() + '\n' + appended;

fs.writeFileSync('test/self-heal.test.ts', usesCrlf ? s.replace(/\n/g, CRLF) : s);
console.log('patched test/self-heal.test.ts: added classifySource regression tests');
