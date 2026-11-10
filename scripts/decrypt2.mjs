import Database from 'better-sqlite3';
import { execSync } from 'child_process';

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
        // VS Code on Windows uses os_crypt: v10 prefix (3 bytes) + DPAPI encrypted
        const encrypted = buf.data.slice(3);
        const b64 = Buffer.from(encrypted).toString('base64');
        
        // Write a PS1 script file to avoid escaping issues
        const keyMatch = row.key.match(/"key":"([^"]+)"/);
        const keyName = keyMatch ? keyMatch[1] : row.key;
        
        const ps1 = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${b64}')
$result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Text.Encoding]::UTF8.GetString($result)
`;
        // Write to temp file
        const fs = require('fs');
        const tmpFile = `C:\\Users\\admin\\AppData\\Local\\Temp\\decrypt_${Date.now()}.ps1`;
        fs.writeFileSync(tmpFile, ps1);
        
        try {
          const decrypted = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { 
            encoding: 'utf8', 
            timeout: 10000 
          }).trim();
          console.log(`${keyName}=${decrypted}`);
        } catch (e) {
          console.error(`Failed to decrypt ${keyName}: ${e.message}`);
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      }
    } catch (e) {
      console.error(`Failed to parse row: ${e.message}`);
    }
  }
}

main();
