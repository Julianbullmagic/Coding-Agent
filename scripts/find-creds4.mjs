import fs from 'fs';

// Check the full storage.json for any extension storage
const storageFile = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/storage.json';
const content = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
const keys = Object.keys(content);
console.log('Total keys in storage.json:', keys.length);
// Show all keys that aren't just UUIDs
const interesting = keys.filter(k => !k.match(/^[0-9a-f-]+$/i));
console.log('Interesting keys:', interesting);

// Now read the state.vscdb SQLite to find extension state
// Let's use a simpler approach - read the better-sqlite3 or sql.js
// Actually, let's just try to find the extension ID from package.json
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Read package.json for the extension ID
const pkg = JSON.parse(fs.readFileSync('c:/Users/admin/Documents/coding-agent-extension/package.json', 'utf8'));
const extId = `${pkg.publisher}.${pkg.name}`;
console.log('\nExtension ID:', extId);
