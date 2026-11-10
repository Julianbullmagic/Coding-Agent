const fs = require('fs');
const os = require('os');
const path = require('path');

const f = path.join(os.homedir(), '.gmail-tokens.json');
console.log('tokens file:', f);
console.log('exists:', fs.existsSync(f));
if (fs.existsSync(f)) {
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('keys:', Object.keys(t).join(','));
  console.log('has access_token:', !!t.access_token);
  console.log('has refresh_token:', !!t.refresh_token);
  console.log('expires_at:', t.expires_at);
  console.log('now:', Date.now());
  console.log('expired:', t.expires_at ? t.expires_at <= Date.now() : 'n/a');
}
