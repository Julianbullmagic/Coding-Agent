const fs = require('fs');
const target = process.argv[2];
const pattern = new RegExp(process.argv[3], 'i');
const lines = fs.readFileSync(target, 'utf8').split('\n');
lines.forEach((line, i) => {
  if (pattern.test(line)) console.log(`${i + 1}: ${line.trim()}`);
});
