import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const dbPath = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
const extId = 'your-name.coding-agent-extension';

try {
  const db = new Database(dbPath, { readonly: true });
  
  // List all tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(t => t.name));
  
  // Query the ItemTable which is where VS Code stores extension state
  const rows = db.prepare("SELECT key, typeof(value) as vtype, length(value) as vlen FROM ItemTable WHERE key LIKE ?").all(`%${extId}%`);
  console.log(`\nRows matching "${extId}":`, rows.length);
  for (const row of rows) {
    console.log(`  key: ${row.key}, type: ${row.vtype}, length: ${row.vlen}`);
  }
  
  // Also search for google-related keys
  const googleRows = db.prepare("SELECT key, typeof(value) as vtype, length(value) as vlen FROM ItemTable WHERE key LIKE '%google%' OR key LIKE '%codingAgent%'").all();
  console.log(`\nRows matching google/codingAgent:`, googleRows.length);
  for (const row of googleRows) {
    console.log(`  key: ${row.key}, type: ${row.vtype}, length: ${row.vlen}`);
    // Try to read the value for credential-related keys
    if (row.key.includes('secret') || row.key.includes('token') || row.key.includes('client')) {
      try {
        const fullRow = db.prepare("SELECT key, value FROM ItemTable WHERE key = ?").get(row.key);
        const val = fullRow.value;
        // It's likely a buffer/string
        const str = typeof val === 'string' ? val : val.toString('utf8');
        console.log(`    value (first 200 chars): ${str.slice(0, 200)}`);
      } catch (e) {
        console.log(`    could not read value: ${e.message}`);
      }
    }
  }
  
  db.close();
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('better-sqlite3 not available, trying sql.js...');
  } else {
    console.error('Error:', e.message);
  }
}
