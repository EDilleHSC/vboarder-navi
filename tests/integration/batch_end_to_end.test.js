const fs = require('fs');
const path = require('path');
const http = require('http');
const { promisify } = require('util');
const waitFor = (ms) => new Promise(r => setTimeout(r, ms));
const copyFile = promisify(fs.copyFile);
const stat = promisify(fs.stat);

const NAVI_ROOT = process.env.NAVI_ROOT || path.resolve(__dirname, '../../NAVI');
const INBOX = path.join(NAVI_ROOT, 'inbox');

function triggerProcess(port = 8005, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({});
    const options = { hostname: '127.0.0.1', port, path: '/process', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function waitUntilSnapshotCounts(expectedAuto, expectedExceptions = 0, timeoutMs = 60000, interval = 500) {
  const SNAPSHOT_DIR = path.join(NAVI_ROOT, 'snapshots', 'inbox');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.existsSync(SNAPSHOT_DIR) ? fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json')) : [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8');
        const snap = JSON.parse(raw);
        const exceptions = (snap.reviewRequiredCount !== undefined) ? snap.reviewRequiredCount : (snap.exceptionCount || 0);
        if ((snap.autoRoutedCount || 0) >= expectedAuto && exceptions === expectedExceptions) {
          return { snapshotFile: f, snapshot: snap };
        }
      } catch (e) { }
    }
    await waitFor(interval);
  }
  throw new Error(`Timeout waiting for snapshot with ${expectedAuto} auto-routed and ${expectedExceptions} exceptions`);
}

function countFilesInOffices() {
  const officesDir = path.join(NAVI_ROOT, 'offices');
  if (!fs.existsSync(officesDir)) return 0;
  let total = 0;
  const offices = fs.readdirSync(officesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  for (const o of offices) {
    const inbox = path.join(officesDir, o, 'inbox');
    if (fs.existsSync(inbox)) {
      const files = fs.readdirSync(inbox).filter(f => !f.endsWith('.navi.json'));
      total += files.length;
    }
  }
  return total;
}

describe('batch end-to-end', () => {
  const fixtureTxt = path.resolve(__dirname, '../fixtures/loric_invoice_sample.txt');
  const COUNT = 10;

  let createdFiles = [];
  const { startTestServer, clearStaleFiles } = require('../helpers/startTestServer');
  let srv = null;

  beforeAll(async () => {
    fs.mkdirSync(INBOX, { recursive: true });
    clearStaleFiles();
    srv = await startTestServer({ port: 8012, timeoutMs: 20000 });
  }, 30000);

  afterAll(async () => {
    // cleanup any leftover test files in inbox (best-effort)
    try {
      const files = fs.readdirSync(INBOX);
      for (const f of files) {
        if (f.startsWith('batch_test_')) fs.unlinkSync(path.join(INBOX, f));
      }
    } catch (e) { }

    if (srv && srv.stop) await srv.stop();
  }, 30000);

  test('processes 10 files end-to-end with zero exceptions', async () => {
    // seed inbox with COUNT files; include one insurance filename to exercise heuristic
    for (let i = 0; i < COUNT - 1; i++) {
      const name = `batch_test_${Date.now()}_${i}.txt`;
      await copyFile(fixtureTxt, path.join(INBOX, name));
      createdFiles.push(name);
    }
    const insuranceName = `Progressive_insurance_${Date.now()}.pdf`;
    await copyFile(fixtureTxt, path.join(INBOX, insuranceName));
    createdFiles.push(insuranceName);

    // trigger processing
    try { await triggerProcess(srv.port); } catch (e) { }

    // wait for snapshot to show COUNT auto-routed and 0 exceptions
    const snapRes = await waitUntilSnapshotCounts(COUNT, 0, 90000);
    const snap = snapRes.snapshot;
    expect(snap.autoRoutedCount).toBeGreaterThanOrEqual(COUNT);
    // snapshot uses reviewRequiredCount for exception counts
    const exceptions = (snap.reviewRequiredCount !== undefined) ? snap.reviewRequiredCount : (snap.exceptionCount || 0);
    expect(exceptions).toBe(0);
    // batch log path is attached to snapshot when available
    if (snap.batch_log) {
      expect(typeof snap.batch_log).toBe('string');
    }

    // Wait until seeded files are removed from inbox (polling, deterministic)
    async function waitUntilInboxCleared(expectedFiles, timeoutMs = 30000, interval = 250) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const inboxFiles = fs.readdirSync(INBOX).filter(f => !f.endsWith('.navi.json'));
        const leftover = expectedFiles.filter(f => inboxFiles.includes(f));
        if (leftover.length === 0) return true;
        await waitFor(interval);
      }
      throw new Error('Timeout waiting for inbox to clear of seeded files: ' + expectedFiles.join(','));
    }

    await waitUntilInboxCleared(createdFiles, 30000);

    // Ensure files exist in offices and count matches (at least COUNT)
    const totalInOffices = countFilesInOffices();
    expect(totalInOffices).toBeGreaterThanOrEqual(COUNT);

  }, 120000);
});