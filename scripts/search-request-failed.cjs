const fs = require('fs');
for (const f of fs.readdirSync('src')) {
    if (!f.endsWith('.ts')) continue;
    const s = fs.readFileSync('src/' + f, 'utf8');
    if (s.includes('Request failed')) console.log('src/' + f, 'contains Request failed');
}
