const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime', 'current');

function waitForHealth(port = 8005, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() < deadline) {
        try {
          await new Promise((res, rej) => {
            const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 2000 }, (r) => res(r));
            req.on('error', rej);
          });
          return resolve(true);
        } catch (e) {
          await new Promise(r => setTimeout(r, 250));
        }
      }
      reject(new Error('Server health check timeout'));
    })();
  });
}

function clearStaleFiles() {
  try { fs.unlinkSync(path.join(RUNTIME_DIR, 'process.lock')); } catch (e) { }
  try { fs.unlinkSync(path.join(RUNTIME_DIR, 'mcp_server.pid')); } catch (e) { }
}

function spawnServer(port = 8005, env = {}) {
  const envVars = Object.assign({}, process.env, env, { PORT: String(port) });
  const node = process.execPath;
  const child = spawn(node, [path.join(RUNTIME_DIR, 'mcp_server.js')], { env: envVars, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

async function startTestServer(opts = {}) {
  const port = opts.port || 0; // 0 => let OS choose; but we prefer explicit port for tests
  const actualPort = opts.port || 8005;
  clearStaleFiles();

  const child = spawnServer(actualPort, opts.env || {});

  // expose logs for debugging
  child.stdout.on('data', d => process.stdout.write('[mcp stdout] ' + d.toString()));
  child.stderr.on('data', d => process.stderr.write('[mcp stderr] ' + d.toString()));

  // wait for health endpoint
  await waitForHealth(actualPort, opts.timeoutMs || 20000);

  return {
    port: actualPort,
    proc: child,
    async stop() {
      try { child.kill(); } catch (e) { }
      // give it a moment and cleanup lock file
      await new Promise(r => setTimeout(r, 200));
      clearStaleFiles();
    }
  };
}

module.exports = { startTestServer, clearStaleFiles, waitForHealth };
