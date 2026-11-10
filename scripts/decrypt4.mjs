import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const DB_PATH = 'C:\\Users\\admin\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb';

function main() {
  const db = new Database(DB_PATH);
  const rows = db.prepare(
    "SELECT key, value FROM ItemTable WHERE key LIKE '%codingAgent.googleClientId%' OR key LIKE '%codingAgent.googleClientSecret%'"
  ).all();

  for (const row of rows) {
    try {
      const buf = JSON.parse(row.value);
      if (buf.type === 'Buffer' && Array.isArray(buf.data)) {
        const keyMatch = row.key.match(/"key":"([^"]+)"/);
        const keyName = keyMatch ? keyMatch[1] : row.key;
        
        // Try different prefix lengths: 0, 1, 2, 3, 4
        for (const prefixLen of [0, 1, 2, 3, 4]) {
          const encrypted = buf.data.slice(prefixLen);
          const b64 = Buffer.from(encrypted).toString('base64');
          
          const ps1 = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${b64}')
$result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Text.Encoding]::UTF8.GetString($result)
`;
          const tmpFile = `C:\\Users\\admin\\AppData\\Local\\Temp\\decrypt_${Date.now()}.ps1`;
          writeFileSync(tmpFile, ps1);
          
          try {
            const decrypted = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { 
              encoding: 'utf8', 
              timeout: 10000 
            }).trim();
            if (decrypted && decrypted.length > 5) {
              console.log(`${keyName} (prefix=${prefixLen}): ${decrypted.substring(0, 10)}...`);
              break;
            }
          } catch (e) {
            // try next prefix
          } finally {
            try { unlinkSync(tmpFile); } catch {}
          }
        }
      }
    } catch (e) {
      console.error(`Failed: ${e.message}`);
    }
  }
}

main();
