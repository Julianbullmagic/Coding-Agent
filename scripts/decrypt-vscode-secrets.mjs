// Decrypt VS Code secrets from state.vscdb using Windows DPAPI
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const DB_PATH = 'C:\\Users\\admin\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb';

function decryptDpapi(encryptedBase64) {
  // Write encrypted bytes to a temp file, then use PowerShell to decrypt with DPAPI
  const psScript = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${encryptedBase64}')
$protected = New-Object System.Security.SecureString
$result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
[System.Text.Encoding]::UTF8.GetString($result)
`;
  try {
    const result = execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { encoding: 'utf8' });
    return result.trim();
  } catch (e) {
    return null;
  }
}

function main() {
  const db = new Database(DB_PATH);
  const rows = db.prepare(
    "SELECT key, value FROM ItemTable WHERE key LIKE '%codingAgent.googleClientId%' OR key LIKE '%codingAgent.googleClientSecret%' OR key LIKE '%codingAgent.gmailClientId%' OR key LIKE '%codingAgent.gmailClientSecret%'"
  ).all();

  const secrets = {};
  for (const row of rows) {
    try {
      const buf = JSON.parse(row.value);
      if (buf.type === 'Buffer' && Array.isArray(buf.data)) {
        // Strip "v10" prefix (VS Code's os_crypt marker)
        const encrypted = buf.data.slice(3);
        const b64 = Buffer.from(encrypted).toString('base64');
        
        // Use PowerShell DPAPI to decrypt
        const psScript = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${b64}')
$result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
[System.Text.Encoding]::UTF8.GetString($result)
`;
        try {
          const decrypted = execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ').replace(/\r/g, '')}"`, { encoding: 'utf8', timeout: 10000 }).trim();
          // Extract a readable key name
          const keyMatch = row.key.match(/"key":"([^"]+)"/);
          const keyName = keyMatch ? keyMatch[1] : row.key;
          secrets[keyName] = decrypted;
        } catch (e) {
          console.error(`Failed to decrypt ${row.key}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`Failed to parse ${row.key}: ${e.message}`);
    }
  }

  console.log(JSON.stringify(secrets, null, 2));
}

main();
