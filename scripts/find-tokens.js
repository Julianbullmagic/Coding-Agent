const fs = require('fs');
const path = require('path');

const globalStorageDir = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage';

try {
    const entries = fs.readdirSync(globalStorageDir);
    console.log('GlobalStorage entries:');
    entries.forEach(e => console.log('  ', e));
    
    // Look for our extension
    const matching = entries.filter(e => e.includes('coding-agent') || e.includes('deepseek'));
    console.log('\nMatching extensions:', matching);
    
    for (const ext of matching) {
        const extDir = path.join(globalStorageDir, ext);
        const files = fs.readdirSync(extDir);
        console.log(`\nFiles in ${ext}:`);
        files.forEach(f => console.log('  ', f));
        
        // Look for state/json files
        for (const f of files) {
            if (f.endsWith('.json') || f.includes('state')) {
                const content = fs.readFileSync(path.join(extDir, f), 'utf8');
                // Check for business tokens
                if (content.includes('business') || content.includes('Business') || content.includes('codingAgent')) {
                    console.log(`\n--- ${f} (relevant content) ---`);
                    try {
                        const parsed = JSON.parse(content);
                        // Look for codingAgent keys
                        for (const key of Object.keys(parsed)) {
                            if (key.includes('codingAgent') || key.includes('business') || key.includes('Business') || key.includes('google')) {
                                const val = parsed[key];
                                if (typeof val === 'string' && val.length > 50) {
                                    console.log(`  ${key}: [length=${val.length}, starts with "${val.substring(0, 30)}..."]`);
                                } else {
                                    console.log(`  ${key}:`, val);
                                }
                            }
                        }
                    } catch {
                        // Not JSON, search as text
                        const lines = content.split('\n');
                        lines.forEach((line, i) => {
                            if (line.includes('business') || line.includes('codingAgent')) {
                                console.log(`  line ${i}: ${line.substring(0, 200)}`);
                            }
                        });
                    }
                }
            }
        }
    }
} catch (e) {
    console.error('Error:', e.message);
}
