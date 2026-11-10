const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log('version:', p.version);
console.log('scripts:', JSON.stringify(p.scripts, null, 2));
console.log('glmModel default:', JSON.stringify(p.contributes?.configuration?.properties?.['codingAgent.glmModel']?.default));
