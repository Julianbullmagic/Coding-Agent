// Trace extractGmailAuthorizationCode against realistic Google inputs.
const { extractGmailAuthorizationCode } = require('../out/src/gmail');

const cases = [
  // (label, input, expected)
  ['full redirect URL',
    'http://localhost/?state=&code=4%2F0AeaYSHDk9zVzy3CjPy2RBexK8zEQ&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.send',
    '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ'],
  ['raw decoded code (contains /)',
    '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ',
    '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ'],
  ['percent-encoded code only (what the address bar shows after code=)',
    '4%2F0AeaYSHDk9zVzy3CjPy2RBexK8zEQ',
    '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ'],
  ['code=... fragment without URL scheme',
    'code=4%2F0AeaYSHDk9zVzy3CjPy2RBexK8zEQ&scope=https%3A%2F%2Fmail.google.com%2F',
    '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ'],
  ['query string with leading ?',
    '?code=4%2F0AeaYSHDk9zVzy3CjPy2RBexK8zEQ',
    '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ'],
  ['code with surrounding whitespace',
    '   4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ   ',
    '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ'],
];

let failures = 0;
for (const [label, input, expected] of cases) {
  const actual = extractGmailAuthorizationCode(input);
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}`);
  console.log(`   input:    ${JSON.stringify(input)}`);
  console.log(`   actual:   ${JSON.stringify(actual)}`);
  console.log(`   expected: ${JSON.stringify(expected)}`);
}
console.log(failures === 0 ? '\nAll cases passed.' : `\n${failures} case(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
