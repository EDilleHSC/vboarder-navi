const request = require('supertest');
const fs = require('fs');
const path = require('path');
const mod = require('../../scripts/serve_presenter.js');
const app = mod;

describe('Packages batch and report API', () => {
  // Use the repo NAVI path so the server (which uses __dirname) will see the fixtures
  const repoRoot = path.join(__dirname, '..', '..');
  const navRoot = path.join(repoRoot, 'NAVI');
  const packagesDir = path.join(navRoot, 'packages');
  const approvalsDir = path.join(navRoot, 'approvals');

  beforeAll(() => {
    // create fixture NAVI structure under the repo NAVI
    fs.mkdirSync(packagesDir, { recursive: true });
    fs.mkdirSync(approvalsDir, { recursive: true });
    // package names that include a batch id token
    const batchId = 'package_2025-12-23_11-38-39';
    const p1 = path.join(packagesDir, `${batchId}_finance`);
    const p2 = path.join(packagesDir, `${batchId}_legal`);
    fs.mkdirSync(p1, { recursive: true });
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p1, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(p2, 'contract.pdf'), 'pdfcontent');
    // README for p1
    fs.writeFileSync(path.join(p1, 'README.txt'), 'Finance package readme');

    // add an audit.log line referencing package
    const auditLog = path.join(approvalsDir, 'audit.log');
    const entry = { timestamp: new Date().toISOString(), action: 'deliver_file', package: `${batchId}_finance`, file: 'a.txt', status: 'success' };
    fs.writeFileSync(auditLog, JSON.stringify(entry) + '\n', { flag: 'a' });
  });

  afterAll(() => {
    // cleanup created packages and approvals entries
    try { fs.rmSync(path.join(packagesDir, 'package_2025-12-23_11-38-39_finance'), { recursive: true, force: true }); } catch(e) {}
    try { fs.rmSync(path.join(packagesDir, 'package_2025-12-23_11-38-39_legal'), { recursive: true, force: true }); } catch(e) {}
    try { fs.rmSync(path.join(approvalsDir, 'audit.log'), { force: true }); } catch(e) {}
  });

  test('GET /api/packages/batch_summary/:batchId returns packages array', async () => {
    const batchId = 'package_2025-12-23_11-38-39';
    const res = await request(app).get(`/api/packages/batch_summary/${encodeURIComponent(batchId)}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.batchId).toBe(batchId);
    expect(res.body.count).toBe(2);
    expect(Array.isArray(res.body.packages)).toBe(true);
    expect(res.body.packages.find(p => p.id.includes('finance'))).toBeDefined();
  });

  test('GET /api/packages/:pkg/report returns readme, files, audits and file timelines', async () => {
    const pkg = 'package_2025-12-23_11-38-39_finance';
    const res = await request(app).get(`/api/packages/${encodeURIComponent(pkg)}/report`);
    expect(res.statusCode).toBe(200);
    expect(res.body.package).toBe(pkg);
    expect(res.body.readme).toContain('Finance package readme');
    expect(Array.isArray(res.body.files)).toBe(true);
    expect(res.body.audits.length).toBeGreaterThan(0);
    expect(res.body.fileTimelines).toBeDefined();
    expect(Array.isArray(res.body.fileTimelines['a.txt'])).toBe(true);
    expect(res.body.fileTimelines['a.txt'].length).toBeGreaterThan(0);
  });
});