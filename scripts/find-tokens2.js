const fs = require('fs');
const path = require('path');

// Check state.vscdb (SQLite) and storage.json for our tokens
const globalStorageDir = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage';

// Try storage.json
const storageJson = path.join(globalStorageDir, 'storage.json');
try {
    const content = fs.readFileSync(storageJson, 'utf8');
    const parsed = JSON.parse(content);
    console.log('storage.json keys:', Object.keys(parsed).length);
    for (const key of Object.keys(parsed)) {
        if (key.includes('codingAgent') || key.includes('business') || key.includes('google') || key.includes('gmail') || key.includes('calendar') || key.includes('token')) {
            const val = parsed[key];
            if (typeof val === 'string' && val.length > 80) {
                console.log(`  ${key}: [length=${val.length}, preview="${val.substring(0, 50)}..."]`);
            } else {
                console.log(`  ${key}:`, val);
            }
        }
    }
} catch (e) {
    console.error('storage.json error:', e.message);
}

// Try agent-host-storage.json
const agentStorage = path.join(globalStorageDir, 'agent-host-storage.json');
try {
    const content = fs.readFileSync(agentStorage, 'utf8');
    const parsed = JSON.parse(content);
    console.log('\nagent-host-storage.json keys:', Object.keys(parsed).length);
    for (const key of Object.keys(parsed)) {
        if (key.includes('codingAgent') || key.includes('business') || key.includes('google') || key.includes('gmail') || key.includes('calendar') || key.includes('token')) {
            const val = parsed[key];
            if (typeof val === 'string' && val.length > 80) {
                console.log(`  ${key}: [length=${val.length}, preview="${val.substring(0, 50)}..."]`);
            } else {
                console.log(`  ${key}:`, val);
            }
        }
    }
} catch (e) {
    console.error('agent-host-storage.json error:', e.message);
}

// Also check workspace storage
const workspaceStorageDir = 'C:/Users/admin/AppData/Roaming/Code/User/workspaceStorage';
try {
    const entries = fs.readdirSync(workspaceStorageDir);
    console.log('\nWorkspaceStorage entries:', entries.length);
    for (const entry of entries) {
        const entryPath = path.join(workspaceStorageDir, entry);
        try {
            const files = fs.readdirSync(entryPath);
            for (const f of files) {
                if (f === 'state.vscdb' || f === 'storage.json') {
                    // skip binary db
                    if (f === 'storage.json') {
                        const content = fs.readFileSync(path.join(entryPath, f), 'utf8');
                        if (content.includes('codingAgent') || content.includes('businessToken')) {
                            console.log(`  Found in ${entry}/${f}`);
                            try {
                                const parsed = JSON.parse(content);
                                for (const key of Object.keys(parsed)) {
                                    if (key.includes('codingAgent') || key.includes('business') || key.includes('token')) {
                                        const val = parsed[key];
                                        if (typeof val === 'string' && val.length > 80) {
                                            console.log(`    ${key}: [length=${val.length}]`);
                                        } else {
                                            console.log(`    ${key}:`, val);
                                        }
                                    }
                                }
                            } catch {}
                        }
                    }
                }
            }
        } catch {}
    }
} catch (e) {
    console.error('workspaceStorage error:', e.message);
}
