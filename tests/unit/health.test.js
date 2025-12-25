const request = require('supertest');
const app = require('../../scripts/serve_presenter.js');

let serverInstance;

describe('Health endpoint', () => {
  beforeAll(async () => { serverInstance = await app.startServer(); });
  afterAll(async () => { await app.stopServer(); });

  test('GET /health returns status and server info', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.server).toBeDefined();
    expect(typeof res.body.server.bound).toBe('boolean');
    expect(res.body.server.port).toBeDefined();
    expect(res.body.server.started_at).toBeDefined();
    expect(Number.isInteger(res.body.server.pid)).toBe(true);
  });
});