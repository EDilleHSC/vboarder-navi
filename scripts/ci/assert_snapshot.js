const fs = require('fs');
const path = require('path');

const snapshotsDir = path.join(__dirname, '..', '..', 'NAVI', 'snapshots', 'inbox');
if (!fs.existsSync(snapshotsDir)) { console.error('No snapshots directory found:', snapshotsDir); process.exit(1); }

const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json')).map(f => ({ f, m: fs.statSync(path.join(snapshotsDir, f)).mtimeMs })).sort((a,b)=>b.m-a.m);
if (files.length === 0) { console.error('No snapshot files found'); process.exit(1); }
const latest = files[0].f;
const data = JSON.parse(fs.readFileSync(path.join(snapshotsDir, latest), 'utf8'));
console.log('Loaded snapshot:', latest);
if (typeof data.autoRoutedCount !== 'number') { console.error('snapshot.autoRoutedCount missing or not a number'); process.exit(1); }
if (data.exceptionCount !== 0) { console.error('snapshot.exceptionCount is non-zero:', data.exceptionCount); process.exit(1); }
console.log('Snapshot checks passed. autoRoutedCount=', data.autoRoutedCount, 'exceptionCount=', data.exceptionCount);
process.exit(0);
