import Database from 'better-sqlite3';
const db = new Database('C:\\Users\\admin\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb');
const rows = db.prepare("SELECT key, substr(value, 1, 200) as val FROM ItemTable WHERE key LIKE '%codingAgent.googleTokens%' OR key LIKE '%codingAgent.gmailTokens%' OR key LIKE '%codingAgent.businessTokens%' OR key LIKE '%codingAgent.calendarTokens%'").all();
console.log(JSON.stringify(rows, null, 2));
