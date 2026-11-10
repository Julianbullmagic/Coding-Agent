const Database = require('better-sqlite3');

const dbPath = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
const db = new Database(dbPath, { readonly: true });

const rows = db.prepare('SELECT key, value FROM ItemTable').all();

// Find ALL keys that might contain tokens
for (const row of rows) {
    const key = row.key;
    if (key.includes('codingAgent') || key.includes('googleTokens') || key.includes('gmailTokens') || key.includes('calendarTokens') || key.includes('businessTokens')) {
        // Try to parse as JSON
        let display = row.value;
        try {
            const parsed = JSON.parse(row.value);
            if (parsed.access_token) {
                parsed.access_token = parsed.access_token.substring(0, 30) + '...';
            }
            if (parsed.refresh_token) {
                parsed.refresh_token = parsed.refresh_token.substring(0, 30) + '...';
            }
            display = JSON.stringify(parsed, null, 2);
        } catch {
            // Show first 200 chars
            display = row.value.substring(0, 200);
        }
        console.log(`KEY: ${key}`);
        console.log(`VALUE: ${display}`);
        console.log('---');
    }
}

// Also check - the tokens might be in a large JSON blob
// Let's search for keys containing "Token" or "token"
console.log('\n\nAll keys containing "token" or "Token":');
for (const row of rows) {
    if (row.key.toLowerCase().includes('token')) {
        console.log(`  ${row.key} (length: ${row.value.length})`);
    }
}

db.close();
