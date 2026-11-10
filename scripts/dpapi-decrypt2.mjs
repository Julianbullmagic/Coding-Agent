import fs from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dbPath = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
const Database = require('better-sqlite3');

const db = new Database(dbPath, { readonly: true });

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

function dpapiDecrypt(encryptedBuffer) {
  // Skip the "v10" prefix (3 bytes)
  const data = encryptedBuffer.slice(3);
  
  const tmpFile = `C:/Users/admin/AppData/Local/Temp/vscode_secret_${Date.now()}.bin`;
  fs.writeFileSync(tmpFile, data);
  
  try {
    // Use PowerShell with proper assembly loading
    const psScript = `
Add-Type -AssemblyName 'System.Security'
$bytes = [System.IO.File]::ReadAllBytes('${tmpFile}')
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
[System.Text.Encoding]::UTF8.GetString($decrypted)
`.trim();
    const tmpPs = `C:/Users/admin/AppData/Local/Temp/decrypt_${Date.now()}.ps1`;
    fs.writeFileSync(tmpPs, psScript);
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, { encoding: 'utf8' }).trim();
    try { fs.unlinkSync(tmpPs); } catch {}
    return result;
  } catch (e) {
    console.error('DPAPI decrypt failed:', e.message?.slice(0, 200));
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// Read the globalState for existing tokens
const extStateRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'your-name.coding-agent-extension'").get();
const state = JSON.parse(typeof extStateRow.value === 'string' ? extStateRow.value : extStateRow.value.toString('utf8'));

console.log('=== Existing tokens ===');
console.log('gmailTokens: access_token exists =', !!state['codingAgent.gmailTokens']?.access_token);
console.log('googleTokens: access_token exists =', !!state['codingAgent.googleTokens']?.access_token);
console.log('businessTokens:', state['codingAgent.businessTokens'] ? 'exists' : 'NOT FOUND');

// Decrypt credentials
console.log('\n=== Decrypting credentials ===');
const clientIdEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientId"}');
const clientSecretEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientSecret"}');

const clientId = dpapiDecrypt(clientIdEncrypted);
const clientSecret = dpapiDecrypt(clientSecretEncrypted);

if (clientId && clientSecret) {
  console.log('Client ID:', clientId.slice(0, 30) + '...');
  console.log('Client Secret length:', clientSecret.length);
  
  // Save for the next script
  const creds = { clientId, clientSecret, 
    gmailTokens: state['codingAgent.gmailTokens'],
    googleTokens: state['codingAgent.googleTokens']
  };
  fs.writeFileSync('c:/Users/admin/Documents/coding-agent-extension/scripts/.google-creds.json', JSON.stringify(creds, null, 2));
  console.log('\nAll credentials and tokens saved to scripts/.google-creds.json');
} else {
  console.log('Failed to decrypt one or both credentials');
  console.log('Client ID result:', clientId);
  console.log('Client Secret result:', clientSecret);
}

db.close();
