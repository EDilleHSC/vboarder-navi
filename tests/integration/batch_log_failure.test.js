const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const waitFor = (ms) => new Promise(r => setTimeout(r, ms));

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const NAVI_ROOT = process.env.NAVI_ROOT || path.join(PROJECT_ROOT, 'NAVI');
const INBOX = path.join(NAVI_ROOT, 'inbox');
const SNAPSHOT_DIR = path.join(NAVI_ROOT, 'snapshots', 'inbox');

function triggerProcess(port = 8005) {
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

function waitForHealth(port = 8005, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(async (resolve, reject) => {
    while (Date.now() < deadline) {
      try {
        const { statusCode } = await new Promise((res, rej) => {
          const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 2000 }, (r) => res(r));
          req.on('error', rej);
        });
        if (statusCode === 200) return resolve(true);
      } catch (e) { /* ignore */ }
      await waitFor(250);
    }
    reject(new Error('Server health check timeout'));
  });
}

function spawnServer(port) {
  const env = Object.assign({}, process.env, { PORT: String(port), BATCH_LOG_THROW: '1' });
  const node = process.execPath;
  const child = spawn(node, [path.join(PROJECT_ROOT, 'runtime', 'current', 'mcp_server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

async function waitUntilSnapshotHas(expectedAuto, expectedReview = 0, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.existsSync(SNAPSHOT_DIR) ? fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json')) : [];
    for (const f of files) {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
        if ((snap.autoRoutedCount || 0) >= expectedAuto && (snap.reviewRequiredCount || 0) === expectedReview) {
          return snap;
        }
      } catch (e) { /* ignore */ }
    }
    await waitFor(250);
  }
  throw new Error('Timeout waiting for expected snapshot');
}

describe('batch logging failure resilience', () => {
  const port = 8007; // isolated port to avoid conflicts
  let serverProc = null;

  beforeAll(async () => {
    // Ensure inbox exists and is clean
    fs.mkdirSync(INBOX, { recursive: true });
    // remove any leftover test files
    for (const f of fs.readdirSync(INBOX)) {
      if (f.startsWith('bf_test_') || f.includes('Progressive_insurance_')) {
        try { fs.unlinkSync(path.join(INBOX, f)); } catch (e) {}
      }
    }

    // remove process.lock if present to avoid skipping
    try { fs.unlinkSync(path.join(__dirname, '..', '..', 'runtime', 'current', 'process.lock')); } catch (e) {}

    // Start a fresh server process with BATCH_LOG_THROW=1
    serverProc = spawnServer(port);

    // Pipe logs for debugging if test fails
    serverProc.stdout.on('data', (d) => console.log('[mcp stdout]', d.toString().trim()));
    serverProc.stderr.on('data', (d) => console.error('[mcp stderr]', d.toString().trim()));

    // Wait for health
    await waitForHealth(port, 15000);
  }, 30000);

  afterAll(async () => {
    if (serverProc) {
      serverProc.kill();
      await waitFor(250);
    }
  });

  test('when batch logging fails, routing and snapshot still succeed', async () => {
    // Seed a few files (including an insurance-named file)
    const COUNT = 5;
    const fixture = path.resolve(__dirname, '../fixtures/loric_invoice_sample.txt');
    const created = [];
    for (let i = 0; i < COUNT - 1; i++) {
      const name = `bf_test_${Date.now()}_${i}.txt`;
      fs.copyFileSync(fixture, path.join(INBOX, name));
      created.push(name);
    }
    const insuranceName = `Progressive_insurance_${Date.now()}.pdf`;
    fs.copyFileSync(fixture, path.join(INBOX, insuranceName));
    created.push(insuranceName);

    // Trigger processing
    try { await triggerProcess(port); } catch (e) { /* ignore if server returns non-JSON */ }

    // Wait for snapshot showing all files auto-routed and 0 reviewRequired
    const snap = await waitUntilSnapshotHas(COUNT, 0, 30000);
    expect(snap.autoRoutedCount).toBeGreaterThanOrEqual(COUNT);
    expect(snap.reviewRequiredCount).toBe(0);

    // Because logBatch threw, snapshot.batch_log should be absent (or not a string)
    expect(!snap.batch_log || typeof snap.batch_log !== 'string').toBe(true);

    // Ensure files moved out of inbox
    const inboxFiles = fs.readdirSync(INBOX).filter(f => !f.endsWith('.navi.json'));
    const leftover = created.filter(f => inboxFiles.includes(f));
    expect(leftover.length).toBe(0);

    // Ensure files exist in offices
    const officesDir = path.join(NAVI_ROOT, 'offices');
    let totalInOffices = 0;
    if (fs.existsSync(officesDir)) {
      const offices = fs.readdirSync(officesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      for (const o of offices) {
        const inbox = path.join(officesDir, o, 'inbox');
        if (fs.existsSync(inbox)) {
          totalInOffices += fs.readdirSync(inbox).filter(f => !f.endsWith('.navi.json')).length;
        }
      }
    }
    expect(totalInOffices).toBeGreaterThanOrEqual(COUNT);
  }, 60000);
});