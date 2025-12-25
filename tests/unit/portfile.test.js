const fs = require('fs');
const path = require('path');
const app = require('../../scripts/serve_presenter.js');

describe('Port file write', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const approvalsDir = path.join(repoRoot, 'NAVI', 'approvals');
  const runStart = path.join(approvalsDir, 'run_start.json');
  let serverInstance;

  beforeAll(async () => {
    fs.mkdirSync(approvalsDir, { recursive: true });
    process.env.WRITE_PORT_FILE = '1';
    serverInstance = await app.startServer();
  });

  afterAll(async () => {
    delete process.env.WRITE_PORT_FILE;
    try { fs.rmSync(runStart, { force: true }); } catch(e) {}
    await app.stopServer();
  });

  test('WRITE_PORT_FILE writes NAVI/approvals/run_start.json', async () => {
    // wait a short time to let file be written
    await new Promise(r => setTimeout(r, 200));
    expect(fs.existsSync(runStart)).toBe(true);
    const content = JSON.parse(fs.readFileSync(runStart, 'utf8'));
    expect(content.port).toBeDefined();
    expect(content.address).toBeDefined();
    expect(content.started_at).toBeDefined();
  });
});