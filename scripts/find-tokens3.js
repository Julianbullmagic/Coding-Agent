const fs = require('fs');
const path = require('path');

// The extension uses globalState which maps to state.vscdb (SQLite)
// Let's use better-sqlite3 or just search all possible locations

const globalStorageDir = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage';

// Check state.vscdb - it's a SQLite database
const stateDb = path.join(globalStorageDir, 'state.vscdb');
console.log('state.vscdb exists:', fs.existsSync(stateDb));
console.log('state.vscdb size:', fs.statSync(stateDb).size);

// Let's try to read it with node's built-in capabilities
// Actually, let's search for the extension ID first in the installed extensions
const extensionsDir = 'C:/Users/admin/AppData/Roaming/Code/User/extensions';
try {
    const entries = fs.readdirSync(extensionsDir);
    const matching = entries.filter(e => e.includes('coding-agent') || e.includes('deepseek'));
    console.log('\nInstalled extensions matching:', matching);
} catch (e) {
    console.error('Extensions dir error:', e.message);
}

// Let's also search for the extension-specific globalStorage
// VS Code uses the full extension ID for the globalStorage folder
// Format: publisher.extensionName
// Let's check all subdirs
try {
    const entries = fs.readdirSync(globalStorageDir);
    console.log('\nAll globalStorage entries:');
    entries.forEach(e => {
        const stat = fs.statSync(path.join(globalStorageDir, e));
        console.log(`  ${e} ${stat.isDirectory() ? '[DIR]' : `[${stat.size}B]`}`);
    });
} catch (e) {
    console.error(e.message);
}

// Check the profiles storage too
const profilesDir = 'C:/Users/admin/AppData/Roaming/Code/User/profiles';
try {
    if (fs.existsSync(profilesDir)) {
        console.log('\nProfiles dir exists');
    }
} catch {}

// Search the entire Roaming/Code directory for our key names
console.log('\nSearching for codingAgent keys in state.vscdb...');
// Read the raw binary and search for our keys
const buf = fs.readFileSync(stateDb);
const content = buf.toString('utf8');
const searchTerms = ['codingAgent', 'businessTokens', 'googleClientId', 'googleTokens', 'calendarTokens', 'gmailTokens'];
for (const term of searchTerms) {
    const idx = content.indexOf(term);
    if (idx >= 0) {
        console.log(`  Found "${term}" at offset ${idx}`);
        // Show context around it
        const start = Math.max(0, idx - 20);
        const end = Math.min(content.length, idx + 200);
        const snippet = content.substring(start, end).replace(/[\x00-\x1f]/g, '.');
        console.log(`    Context: ...${snippet}...`);
    } else {
        console.log(`  "${term}" NOT found`);
    }
}
