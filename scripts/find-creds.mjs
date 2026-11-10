import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Try to decrypt VS Code secrets using the electron/vscode decryption
// VS Code stores secrets in state.vscdb with encryption using the machine key

const globalStorageDir = path.join(
  process.env.APPDATA || '',
  'Code', 'User', 'globalStorage'
);

const stateDb = path.join(globalStorageDir, 'state.vscdb');

const Database = (await import('better-sqlite3')).default;
const db = new Database(stateDb, { readonly: true });

// Get the raw encrypted values for our keys
const keys = [
  'codingAgent.googleClientId',
  'codingAgent.googleClientSecret',
  'codingAgent.gmailClientId',
  'codingAgent.gmailClientSecret',
];

for (const key of keys) {
  const dbKey = `secret://{"extensionId":"your-name.coding-agent-extension","key":"${key}"}`;
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(dbKey);
  if (row) {
    const parsed = JSON.parse(row.value);
    const buf = Buffer.from(parsed.data);
    console.log(`${key}: encrypted (${buf.length} bytes), starts with: ${buf.slice(0, 4).toString('hex')}`);
  }
}

// Also check for stored tokens
const tokenKeys = rows = db.prepare("SELECT key FROM ItemTable WHERE key LIKE '%token%' OR key LIKE '%Token%' OR key LIKE '%google%' OR key LIKE '%gmail%'").all();
console.log('\nToken-related keys:');
for (const r of rows) {
  if (r.key.startsWith('secret://')) continue; // skip encrypted secrets we already checked
  console.log('  ', r.key);
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(r.key);
  if (row && row.value && row.value.length < 500) {
    console.log('    ', row.value.slice(0, 200));
  }
}

db.close();
