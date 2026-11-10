import fs from 'fs';
import path from 'path';

const storageDir = 'C:/Users/admin/AppData/Roaming/Code/User/globalStorage';
const entries = fs.readdirSync(storageDir);
console.log('All entries:', entries.join('\n'));
