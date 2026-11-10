// Use VS Code's own keytar/keychain to decrypt secrets via the extension host
// We'll call the VS Code CLI's list-extensions-commands approach
// Actually, let's just use the keytar node module that VS Code uses

import Database from 'better-sqlite3';
import { execSync } from 'child_process';

const DB_PATH = 'C:\\Users\\admin\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb';

function main() {
  const db = new Database(DB_PATH);
  const rows = db.prepare(
    "SELECT key, value FROM ItemTable WHERE key LIKE '%codingAgent.googleClientId%'"
  ).all();

  for (const row of rows) {
    try {
      const buf = JSON.parse(row.value);
      if (buf.type === 'Buffer' && Array.isArray(buf.data)) {
        // Print the raw bytes in hex for analysis
        console.log('Raw bytes (hex):', Buffer.from(buf.data).toString('hex'));
        console.log('Length:', buf.data.length);
        console.log('First 10 bytes:', buf.data.slice(0, 10));
        // VS Code's os_crypt on Windows uses: "v10" (3 bytes) + AES-GCM encrypted with a DPAPI-protected key
        // The key is stored in LocalAppData. Let's try using Chrome's approach
        // Actually, VS Code >=1.86 uses the same os_crypt as Chromium
      }
    } catch (e) {
      console.error(e.message);
    }
  }
}

main();
