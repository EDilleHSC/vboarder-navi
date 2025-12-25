const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../../scripts/serve_presenter.js');


describe('Approvals audit API', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const approvalsDir = path.join(repoRoot, 'NAVI', 'approvals');
  const auditLog = path.join(approvalsDir, 'audit.log');
  let serverInstance;

  beforeAll(async () => {
    fs.mkdirSync(approvalsDir, { recursive: true });
    // write a JSON entry and a legacy entry
    const entry = { timestamp: new Date().toISOString(), action: 'test_audit', user: 'tester', detail: 'ok' };
    fs.writeFileSync(auditLog, JSON.stringify(entry) + '\n', { flag: 'a' });
    fs.writeFileSync(auditLog, `[${new Date().toISOString()}] Legacy audit line for testing\n`, { flag: 'a' });
    // start server to populate health/server info if needed
    serverInstance = await app.startServer();
  });

  afterAll(async () => {
    try { fs.rmSync(auditLog, { force: true }); } catch (e) {}
    await app.stopServer();
  });

  test('GET /approvals/audit returns parsed entries and pagination', async () => {
    const res = await request(app).get('/approvals/audit');
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.entries)).toBe(true);
    // ensure at least one parsed JSON-style entry and one legacy entry
    const hasJson = res.body.entries.some(e => e.action === 'test_audit');
    const hasLegacy = res.body.entries.some(e => e.legacy === true || e.raw);
    expect(hasJson).toBe(true);
    expect(hasLegacy).toBe(true);
  });
});