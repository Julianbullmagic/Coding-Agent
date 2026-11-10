// Decrypt VS Code secrets using os_crypt (Chromium-style: v10 + AES-256-GCM)
// The encryption key is stored in the Local State file and protected by DPAPI
import Database from 'better-sqlite3';
import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createDecipheriv } from 'crypto';

const DB_PATH = 'C:\\Users\\admin\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb';
const LOCAL_STATE_PATH = 'C:\\Users\\admin\\AppData\\Roaming\\Code\\Local State';

function getEncryptionKey() {
  // Read the encrypted_key from Local State
  const localState = JSON.parse(readFileSync(LOCAL_STATE_PATH, 'utf8'));
  const encryptedKeyB64 = localState.os_crypt.encrypted_key;
  const encryptedKeyBuf = Buffer.from(encryptedKeyB64, 'base64');
  
  // Strip "DPAPI" prefix (5 bytes)
  const dpapiEncrypted = encryptedKeyBuf.slice(5);
  
  // Decrypt with DPAPI
  const b64 = dpapiEncrypted.toString('base64');
  const ps1 = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${b64}')
$result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($result)
`;
  const tmpFile = `C:\\Users\\admin\\AppData\\Local\\Temp\\decrypt_key_${Date.now()}.ps1`;
  writeFileSync(tmpFile, ps1);
  
  try {
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { 
      encoding: 'utf8', 
      timeout: 10000 
    }).trim();
    return Buffer.from(result, 'base64');
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function decryptOsCrypt(encryptedBuf, encryptionKey) {
  // v10 prefix (3 bytes) + nonce (12 bytes) + ciphertext + auth tag (16 bytes)
  const prefix = encryptedBuf.slice(0, 3).toString('utf8'); // should be "v10"
  const nonce = encryptedBuf.slice(3, 15);
  const ciphertextWithTag = encryptedBuf.slice(15);
  
  // AES-256-GCM: the last 16 bytes of ciphertextWithTag are the auth tag
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
  decipher.setAuthTag(ciphertextWithTag.slice(-16));
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertextWithTag.slice(0, -16)),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function main() {
  const encryptionKey = getEncryptionKey();
  console.log('Encryption key length:', encryptionKey.length);
  
  const db = new Database(DB_PATH);
  const rows = db.prepare(
    "SELECT key, value FROM ItemTable WHERE key LIKE '%codingAgent.googleClientId%' OR key LIKE '%codingAgent.googleClientSecret%'"
  ).all();

  const secrets = {};
  
  for (const row of rows) {
    try {
      const buf = JSON.parse(row.value);
      if (buf.type === 'Buffer' && Array.isArray(buf.data)) {
        const encryptedBuf = Buffer.from(buf.data);
        const decrypted = decryptOsCrypt(encryptedBuf, encryptionKey);
        
        const keyMatch = row.key.match(/"key":"([^"]+)"/);
        const keyName = keyMatch ? keyMatch[1] : row.key;
        secrets[keyName] = decrypted;
        console.log(`${keyName} = ${decrypted.substring(0, 15)}...`);
      }
    } catch (e) {
      console.error(`Failed: ${e.message}`);
    }
  }
  
  // Write secrets to a temp file for the next script to use
  writeFileSync('C:\\Users\\admin\\AppData\\Local\\Temp\\google_creds.json', JSON.stringify(secrets));
  console.log('\nCredentials saved to temp file.');
}

main();
