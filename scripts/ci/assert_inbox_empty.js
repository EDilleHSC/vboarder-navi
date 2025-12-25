const fs = require('fs');
const path = require('path');

const inboxDir = path.join(__dirname, '..', '..', 'NAVI', 'inbox');
if (!fs.existsSync(inboxDir)) { console.log('Inbox directory not found (treated as empty)'); process.exit(0); }
const files = fs.readdirSync(inboxDir).filter(f => fs.statSync(path.join(inboxDir, f)).isFile());
if (files.length > 0) {
  console.error('Inbox is not empty. Found files:', files.slice(0,50));
  process.exit(1);
}
console.log('Inbox is empty');
process.exit(0);
