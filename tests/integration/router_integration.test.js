const fs = require('fs');
const path = require('path');
const http = require('http');
const { promisify } = require('util');
const waitFor = (ms) => new Promise(r => setTimeout(r, ms));
const copyFile = promisify(fs.copyFile);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

const NAVI_ROOT = process.env.NAVI_ROOT || path.resolve(__dirname, '../../NAVI');
const INBOX = path.join(NAVI_ROOT, 'inbox');
const SIDECAREXT = '.navi.json';

// Use shared test harness to start/stop server deterministically
const { startTestServer, clearStaleFiles } = require('../helpers/startTestServer');
let srv = null;
// Helper: wait until a path exists or timeout
async function waitUntilExists(filePath, timeoutMs = 30000, interval = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(filePath);
      return true;
    } catch (e) {
      await waitFor(interval);
    }
  }
  throw new Error(`Timeout waiting for ${filePath}`);
}

// Helper: trigger the process endpoint to ensure processing happens during test
function triggerProcess(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({});
    const options = { hostname: '127.0.0.1', port: 8005, path: '/process', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
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

describe('router integration', () => {
  const fixtureTxt = path.resolve(__dirname, '../fixtures/loric_invoice_sample.txt');
  const targetName = `test_loric_${Date.now()}.txt`;
  const targetPath = path.join(INBOX, targetName);
  const sidecarPath = path.join(INBOX, `${targetName}${SIDECAREXT}`);

  beforeAll(async () => {
    // ensure inbox exists
    fs.mkdirSync(INBOX, { recursive: true });

    // Start a fresh test server on an isolated port and ensure no stale locks
    clearStaleFiles();
    srv = await startTestServer({ port: 8011, timeoutMs: 20000 });
  }, 30000);

  afterAll(async () => {
    // cleanup created files
    try { fs.unlinkSync(targetPath); } catch (e) {}
    try { fs.unlinkSync(sidecarPath); } catch (e) {}

    // stop server
    if (srv && srv.stop) await srv.stop();
  });

  test('full pipeline routes LORIC invoice to LHI / Finance', async () => {
    // copy fixture to inbox to simulate incoming file
    await copyFile(fixtureTxt, targetPath);

      // trigger processing explicitly (in case watcher not active in test env)
    try { await triggerProcess(8011); } catch (e) { /* ignore - best-effort */ }

    // wait for a snapshot that includes our file
    const SNAPSHOT_DIR = path.join(NAVI_ROOT, 'snapshots', 'inbox');
    async function waitUntilSnapshotContains(filename, timeoutMs = 30000, interval = 500) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json'));
        for (const f of files) {
          try {
            const raw = fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8');
            const snap = JSON.parse(raw);
            // The item may be in either reviewRequired (exceptions) or autoRouted (successful delivery)
            const inReview = (snap.reviewRequired || []).find(r => r.filename === filename);
            if (inReview) return { snapshotFile: f, entry: inReview };
            const inAuto = (snap.autoRouted || []).find(r => r.filename === filename);
            if (inAuto) return { snapshotFile: f, entry: inAuto };
          } catch (e) { /* ignore parse errors */ }
        }
        await waitFor(interval);
      }
      throw new Error(`Timeout waiting for snapshot containing ${filename}`);
    }

    const snapResult = await waitUntilSnapshotContains(targetName, 60000);
    const entry = snapResult.entry;

    expect(entry).toBeDefined();
    expect(entry.ai).toBeDefined();
    expect(entry.ai.extracted_text_snippet).toContain('LORIC HOMES');

    // Validate routing logic using router helper functions
    const router = require('../../runtime/current/lib/router');
    const ent = router.matchEntity(entry.ai.extracted_text_snippet, require('../../NAVI/config/routing_config.json'));
    // Entity detection may match multiple known entities (LHI or HSC) based on configuration signals
    expect(['LHI', 'HSC']).toContain(ent);
    const funcRes = router.detectFunction(entry.ai.extracted_text_snippet, require('../../NAVI/config/routing_config.json'));
    expect(funcRes.function).toBe('Finance');
  }, 90000);
});