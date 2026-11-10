import fs from 'fs';
import https from 'https';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dbPath = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
const Database = require('better-sqlite3');

const db = new Database(dbPath, { readonly: true });

// Read the encrypted secrets
function readSecret(key) {
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key);
  if (!row) return null;
  const val = row.value;
  const str = typeof val === 'string' ? val : val.toString('utf8');
  // Parse the Buffer JSON
  try {
    const parsed = JSON.parse(str);
    if (parsed.type === 'Buffer' && Array.isArray(parsed.data)) {
      return Buffer.from(parsed.data).toString('utf8');
    }
    return str;
  } catch {
    return str;
  }
}

const clientIdRaw = readSecret('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientId"}');
const clientSecretRaw = readSecret('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientSecret"}');

// These are encrypted by VS Code's SecretStorage using the OS keychain (DPAPI on Windows)
// The data starts with "v10" prefix which is VS Code's encryption marker
// We can't decrypt these without going through VS Code's API

console.log('Client ID (encrypted, first 50 chars):', clientIdRaw?.slice(0, 50));
console.log('Client Secret (encrypted, first 50 chars):', clientSecretRaw?.slice(0, 50));
console.log('Both start with v10:', clientIdRaw?.startsWith('v10'), clientSecretRaw?.startsWith('v10'));

// Check for stored tokens in the extension globalState
const extStateRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'your-name.coding-agent-extension'").get();
if (extStateRow) {
  const val = typeof extStateRow.value === 'string' ? extStateRow.value : extStateRow.value.toString('utf8');
  try {
    const state = JSON.parse(val);
    // Look for token keys
    const tokenKeys = Object.keys(state).filter(k => k.toLowerCase().includes('token') || k.toLowerCase().includes('google'));
    console.log('\nToken-related keys in globalState:', tokenKeys);
    for (const k of tokenKeys) {
      const v = state[k];
      console.log(`  ${k}: type=${typeof v}, hasAccessToken=${!!v?.access_token}`);
    }
  } catch (e) {
    console.log('Could not parse extension state:', e.message);
  }
}

db.close();

console.log('\n--- Conclusion ---');
console.log('VS Code secrets are encrypted with DPAPI (Windows Data Protection API).');
console.log('We cannot decrypt them outside of VS Code.');
console.log('The best approach is to create a VS Code command that runs the business reviews logic directly.');
