const { spawnSync } = require('child_process');
const path = require('path');

describe('wait_for_presenter helper', () => {
  test('exits with code 2 on timeout when no server', () => {
    const script = path.join(__dirname, '..', '..', 'tools', 'wait_for_presenter.js');
    const res = spawnSync('node', [script, '--port', '59999', '--timeout', '1000'], { encoding: 'utf8', timeout: 5000 });
    // exit code 2 is used for timeout in the script
    expect(res.status).toBe(2);
    expect(res.stderr || '').toContain('timeout waiting for presenter');
  });
});