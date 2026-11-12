const fs = require('fs');
const lines = fs.readFileSync('src/extension.ts', 'utf8').split('\n');
lines.forEach((l, i) => {
    if (/DEFAULT_NEWS_SOURCES|sanitizeSources|newsSources/.test(l)) {
        console.log((i + 1) + ': ' + l.trim().slice(0, 200));
    }
});
