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

// Try different decryption approaches
const clientIdEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientId"}');

console.log('Encrypted data length:', clientIdEncrypted.length, 'bytes');
console.log('First 10 bytes (hex):', clientIdEncrypted.slice(0, 10).toString('hex'));
console.log('First 3 bytes as string:', clientIdEncrypted.slice(0, 3).toString('utf8'));

// Approach 1: DPAPI decrypt of the entire blob (skip v10 prefix)
async function tryDpapi(data, label) {
  const tmpBin = `C:/Users/admin/AppData/Local/Temp/dpapi_test_${Date.now()}.bin`;
  
  // Try with v10 prefix skipped
  for (const [skip, desc] of [[0, 'full blob'], [3, 'skip v10']]) {
    const chunk = data.slice(skip);
    fs.writeFileSync(tmpBin, chunk);
    
    const dpapiPs = `
Add-Type -AssemblyName 'System.Security'
$bytes = [System.IO.File]::ReadAllBytes('${tmpBin}')
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
[Convert]::ToBase64String($decrypted)
`;
    const psFile = `C:/Users/admin/AppData/Local/Temp/dpapi_${Date.now()}.ps1`;
    fs.writeFileSync(psFile, dpapiPs);
    
    try {
      const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { 
        encoding: 'utf8',
        timeout: 15000
      }).trim();
      
      const decrypted = Buffer.from(result, 'base64').toString('utf8');
      console.log(`  ${label} (${desc}): SUCCESS - starts with "${decrypted.slice(0, 20)}..."`);
      return decrypted;
    } catch {
      console.log(`  ${label} (${desc}): failed`);
    } finally {
      try { fs.unlinkSync(tmpBin); } catch {}
      try { fs.unlinkSync(psFile); } catch {}
    }
  }
  return null;
}

// Approach 2: Check if the data is base64-encoded DPAPI blob
async function tryBase64Dpapi(data, label) {
  const withoutPrefix = data.slice(3).toString('utf8'); // skip v10
  try {
    const decoded = Buffer.from(withoutPrefix, 'base64');
    const tmpBin = `C:/Users/admin/AppData/Local/Temp/dpapi_b64_${Date.now()}.bin`;
    fs.writeFileSync(tmpBin, decoded);
    
    const dpapiPs = `
Add-Type -AssemblyName 'System.Security'
$bytes = [System.IO.File]::ReadAllBytes('${tmpBin}')
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
[System.Text.Encoding]::UTF8.GetString($decrypted)
`;
    const psFile = `C:/Users/admin/AppData/Local/Temp/dpapi_b64_${Date.now()}.ps1`;
    fs.writeFileSync(psFile, dpapiPs);
    
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { 
      encoding: 'utf8',
      timeout: 15000
    }).trim();
    
    console.log(`  ${label} (base64+DPAPI): SUCCESS - starts with "${result.slice(0, 20)}..."`);
    return result;
  } catch {
    console.log(`  ${label} (base64+DPAPI): failed`);
  }
  return null;
}

console.log('\n=== Trying DPAPI decryption approaches ===');
let clientId = null;
let clientSecret = null;

// Try for Client ID
console.log('\nClient ID:');
clientId = await tryDpapi(clientIdEncrypted, 'Client ID');
if (!clientId) clientId = await tryBase64Dpapi(clientIdEncrypted, 'Client ID');

// Try for Client Secret
console.log('\nClient Secret:');
const clientSecretEncrypted = readSecretBuffer('secret://{"extensionId":"your-name.coding-agent-extension","key":"codingAgent.googleClientSecret"}');
clientSecret = await tryDpapi(clientSecretEncrypted, 'Client Secret');
if (!clientSecret) clientSecret = await tryBase64Dpapi(clientSecretEncrypted, 'Client Secret');

if (clientId && clientSecret) {
  console.log('\n=== SUCCESS ===');
  console.log('Client ID:', clientId.slice(0, 40) + '...');
  console.log('Client Secret length:', clientSecret.length);
  
  // Save credentials
  const extStateRow = db.prepare("SELECT value FROM ItemTable WHERE key = 'your-name.coding-agent-extension'").get();
  const state = JSON.parse(typeof extStateRow.value === 'string' ? extStateRow.value : extStateRow.value.toString('utf8'));
  
  fs.writeFileSync('c:/Users/admin/Documents/coding-agent-extension/scripts/.google-creds.json', JSON.stringify({
    clientId,
    clientSecret,
    gmailTokens: state['codingAgent.gmailTokens'],
    googleTokens: state['codingAgent.googleTokens']
  }, null, 2));
  console.log('Saved to scripts/.google-creds.json');
} else {
  console.log('\nCould not decrypt with any approach.');
  console.log('The encryption format may be newer Chromium os_crypt (AES-256-GCM).');
  console.log('Since there\'s no key in Credential Manager, it might use a different key derivation.');
}

db.close();
