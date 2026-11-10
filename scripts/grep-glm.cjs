const fs = require('fs');
const path = require('path');
const root = process.argv[2] || 'src';
const results = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|mjs|js|json)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/glm-5\.3|glm/i.test(line)) results.push(`${full}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}
walk(root);
console.log(results.join('\n') || 'NO_MATCHES');
