const Database = require('better-sqlite3');
const fs = require('fs');

const dbPath = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage/state.vscdb';
const db = new Database(dbPath, { readonly: true });

// The VS Code state DB has a table called 'ItemTable' with key/value pairs
const rows = db.prepare('SELECT key, value FROM ItemTable').all();

console.log(`Total rows in ItemTable: ${rows.length}\n`);

const relevantKeys = [
    'codingAgent.googleClientId',
    'codingAgent.googleClientSecret', 
    'codingAgent.googleTokens',
    'codingAgent.gmailTokens',
    'codingAgent.calendarTokens',
    'codingAgent.businessTokens',
];

for (const row of rows) {
    if (row.key.includes('codingAgent')) {
        let value = row.value;
        try {
            const parsed = JSON.parse(value);
            // Mask sensitive values
            if (parsed.access_token) {
                parsed.access_token = parsed.access_token.substring(0, 20) + '...[masked]';
            }
            if (parsed.refresh_token) {
                parsed.refresh_token = parsed.refresh_token.substring(0, 20) + '...[masked]';
            }
            value = JSON.stringify(parsed);
        } catch {}
        
        if (row.key.includes('Secret') || row.key.includes('secret')) {
            // Try to read as buffer
            try {
                const parsed = JSON.parse(row.value);
                if (parsed.type === 'Buffer' && parsed.data) {
                    value = '[ENCRYPTED BUFFER - ' + parsed.data.length + ' bytes]';
                }
            } catch {}
        }
        
        console.log(`${row.key}: ${value}`);
    }
}

db.close();
