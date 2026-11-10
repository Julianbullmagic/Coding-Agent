import fs from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dbPath = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
const Database = require('better-sqlite3');

const db = new Database(dbPath, { readonly: true });

// Read raw encrypted bytes from DB
function readSecretBuffer(key) {
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key);
  if (!row) return null;
  const val = row.value;
  const str = typeof val === 'string' ? val : val.toString('utf8');
  try {
    const parsed = JSON.parse(str);
    if (parsed.type === 'Buffer' && Array.isArray(parsed.data)) {
      return Buffer.from(parsed.data);
    }
    return Buffer.from(str, 'utf8');
  } catch {
    return Buffer.from(str, 'utf8');
  }
}

// Read the globalState for tokens
const extStateRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'your-name.coding-agent-extension'").get();
const state = JSON.parse(typeof extStateRow.value === 'string' ? extStateRow.value : extStateRow.value.toString('utf8'));

console.log('=== GlobalState token keys ===');
const tokenKeys = Object.keys(state).filter(k => k.toLowerCase().includes('token'));
for (const k of tokenKeys) {
  const v = state[k];
  if (typeof v === 'object' && v !== null) {
    console.log(`${k}: has access_token=${!!v.access_token}, has refresh_token=${!!v.refresh_token}, expires_at=${v.expires_at}`);
  } else {
    console.log(`${k}: ${typeof v}`);
  }
}

// Check if businessTokens exists
if (state['codingAgent.businessTokens']) {
  console.log('\nBusiness tokens already exist!');
  console.log('access_token starts with:', state['codingAgent.businessTokens'].access_token?.slice(0, 20) + '...');
} else {
  console.log('\nNo businessTokens in globalState yet - need to authorize');
}

// DPAPI decrypt approach: write the encrypted bytes to a temp file, then use PowerShell to decrypt
function dpapiDecrypt(encryptedBuffer) {
  // Skip the "v10" prefix (3 bytes)
  const data = encryptedBuffer.slice(3);
  
  // Write to temp file
  const tmpFile = `C:/Users/admin/AppData/Local/Temp/vscode_secret_${Date.now()}.bin`;
  fs.writeFileSync(tmpFile, data);
  
  try {
    // Use PowerShell with DPAPI to decrypt
    const psScript = `
      Add-Type -AssemblyName System.Security
      $bytes = [System.IO.File]::ReadAllBytes('${tmpFile.replace(/\\/g, '\\\\')}')
      $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.Text.Encoding]::UTF8.GetString($decrypted)
    `;
    const result = execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
    return result;
  } catch (e) {
    console.error('DPAPI decrypt failed:', e.message);
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// Try to decrypt the client ID and secret
console.log('\n=== Attempting DPAPI decryption ===');
const clientIdEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientId"}');
const clientSecretEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientSecret"}');

const clientId = dpapiDecrypt(clientIdEncrypted);
const clientSecret = dpapiDecrypt(clientSecretEncrypted);

if (clientId && clientSecret) {
  console.log('Client ID:', clientId.slice(0, 30) + '...');
  console.log('Client Secret:', clientSecret.slice(0, 10) + '...');
  
  // Now we have everything - write them to a temp file for the next script
  const creds = { clientId, clientSecret };
  fs.writeFileSync('c:/Users/admin/Documents/coding-agent-extension/scripts/.google-creds.json', JSON.stringify(creds));
  console.log('\nCredentials saved to scripts/.google-creds.json');
} else {
  console.log('Could not decrypt credentials');
}

db.close();
