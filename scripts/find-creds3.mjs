import fs from 'fs';
import path from 'path';

// Check storage.json
const storageFile = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/storage.json';
if (fs.existsSync(storageFile)) {
  const content = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
  const keys = Object.keys(content);
  const relevant = keys.filter(k => k.toLowerCase().includes('google') || k.toLowerCase().includes('client') || k.toLowerCase().includes('codingagent'));
  console.log('storage.json keys with google/client/codingagent:', relevant);
  for (const k of relevant) {
    const val = content[k];
    console.log(`  ${k}: ${typeof val === 'string' ? val.slice(0, 80) + '...' : JSON.stringify(val).slice(0, 80)}`);
  }
}

// Check state.vscdb - it's a SQLite database
const dbFile = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
if (fs.existsSync(dbFile)) {
  console.log('\nstate.vscdb exists, size:', fs.statSync(dbFile).size);
}

// Also check the secrets stored by VS Code - on Windows they're in Credential Manager
// Let's also check the extension's specific storage
const storageDir = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage';
const entries = fs.readdirSync(storageDir, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isDirectory()) {
    console.log(`\nDirectory: ${entry.name}`);
    try {
      const subFiles = fs.readdirSync(path.join(storageDir, entry.name));
      console.log('  Files:', subFiles.join(', '));
    } catch {}
  }
}
