/** @jest-environment node */
const request = require('supertest');
const path = require('path');
const fs = require('fs');

jest.setTimeout(30000); // allow up to 30s for zipping

let app;
let server;

beforeAll(async () => {
  // require the presenter server module and start the listener for tests that need network access
  const mod = require('../../scripts/serve_presenter.js'); // adjust path if needed
  app = mod;
  server = await app.startServer();
});

afterAll(async () => {
  // stop the listener cleanly
  await app.stopServer();
});

test('GET /api/packages returns array', async () => {
  const res = await request(app).get('/api/packages');
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('GET /presenter/packages.html served', async () => {
  const res = await request(app).get('/presenter/packages.html');
  expect(res.statusCode).toBe(200);
  expect(res.text).toContain('NAVI Packages');
});

test('GET /api/packages/:pkg/download returns zip', async () => {
  // create a temp package in the packages dir
  const packagesDir = path.join(__dirname, '..', '..', 'NAVI', 'packages');
  const pkgName = 'test_pkg_for_download';
  const pkgDir = path.join(packagesDir, pkgName);
  if (!fs.existsSync(packagesDir)) fs.mkdirSync(packagesDir, { recursive: true });
  if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });
  // add a small file
  fs.writeFileSync(path.join(pkgDir, 'foo.txt'), 'hello');

  const res = await request(app)
    .get(`/api/packages/${encodeURIComponent(pkgName)}/download`)
    .buffer(true)
    .parse((res, callback) => {
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(data)));
    });

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/zip/);
  expect(res.body.length).toBeGreaterThan(0);

  // now check cache status endpoint
  const st = await request(app).get('/api/packages/cache/status');
  expect(st.statusCode).toBe(200);
  const body = st.body;
  expect(Array.isArray(body)).toBe(true);
  const entry = body.find(x => x.pkgName === pkgName);
  expect(entry).toBeDefined();
  expect(entry.status).toMatch(/valid|stale|missing/);

  // purge cache and ensure it's removed
  const purge = await request(app).post(`/api/packages/${encodeURIComponent(pkgName)}/cache/purge`);
  expect([204,404]).toContain(purge.statusCode);

  // cleanup
  fs.rmSync(pkgDir, { recursive: true, force: true });
});

test('GET /api/packages/:pkg/files 404 for missing package', async () => {
  const res = await request(server).get('/api/packages/doesnotexist/files');
  expect(res.statusCode).toBe(404);
});

// Note: for full integration tests, a test-specific package dir should be created and cleaned up
