const fs = require('fs');
const path = require('path');
const os = require('os');
const { logBatch } = require('../../runtime/current/lib/batch_log');

describe('batch_log', () => {
  const tmpRoot = path.join(os.tmpdir(), 'vboarder-batchlog-test');

  beforeAll(() => {
    if (!fs.existsSync(tmpRoot)) fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    // cleanup test artifacts
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  });

  test('writes batch file and returns path', () => {
    const stats = { files_processed: 3, auto_routed: { Finance: 2 }, errors: 0 };
    const p = logBatch(stats, { naviRoot: tmpRoot });
    expect(typeof p).toBe('string');
    expect(fs.existsSync(p)).toBe(true);

    const content = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(content.files_processed).toBe(3);
    expect(content.auto_routed.Finance).toBe(2);
  });

  test('throws when no stats provided', () => {
    expect(() => logBatch()).toThrow();
  });
});