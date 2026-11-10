const fs = require('fs');
const s = fs.readFileSync('src/extension.ts', 'utf8').split(/\r?\n/);
s.forEach((l, i) => {
    if (l.includes('Request failed') || l.includes('provideSuggestions') || l.includes('GLM') || l.includes('glm')) {
        console.log((i + 1) + ': ' + l);
    }
});
