const Database = require('../node_modules/better-sqlite3');
const db = new Database('C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb');

// List all codingAgent keys
const rows = db.prepare("SELECT key FROM ItemTable WHERE key LIKE '%codingAgent%'").all();
console.log('Keys found:');
rows.forEach(r => console.log(' ', r.key));

// Get the token keys (don't print actual tokens)
const tokenKeys = rows.filter(r => r.key.toLowerCase().includes('token') || r.key.toLowerCase().includes('secret'));
console.log('\nToken/secret keys:', tokenKeys.map(r => r.key));

// Check if business tokens exist
const businessTokens = rows.find(r => r.key === 'codingAgent.businessTokens');
console.log('\nBusiness tokens exist:', !!businessTokens);

// Get client ID (non-secret, needed to understand setup)
const clientIdRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'codingAgent.googleClientId'").get();
console.log('Has Client ID:', !!clientIdRow && !!clientIdRow.value);

const clientSecretRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'codingAgent.googleClientSecret'").get();
console.log('Has Client Secret:', !!clientSecretRow && !!clientSecretRow.value);

// Check for existing Google tokens (calendar/gmail) - just check existence, don't print values
const googleTokensRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'codingAgent.googleTokens'").get();
console.log('Has Google (Calendar) tokens:', !!googleTokensRow && !!googleTokensRow.value);

const gmailTokensRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'codingAgent.gmailTokens'").get();
console.log('Has Gmail tokens:', !!gmailTokensRow && !!gmailTokensRow.value);

db.close();
