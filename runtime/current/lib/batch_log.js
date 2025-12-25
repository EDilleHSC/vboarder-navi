const fs = require('fs');
const path = require('path');

function logBatch(batchStats, options = {}) {
  if (!batchStats) throw new Error('batchStats is required');

  // Test hook: allow simulated failure via env var for testing robustness
  if (process.env.BATCH_LOG_THROW === '1') {
    throw new Error('simulated batch log failure (env:BATCH_LOG_THROW=1)');
  }

  // Determine NAVI root: prefer options override, then env var, then relative NAVI
  const naviRoot = options.naviRoot || process.env.NAVI_ROOT || path.resolve(__dirname, '..', '..', 'NAVI');

  const date = new Date();
  const dateDir = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = path.join(naviRoot, 'logs', 'batches', dateDir);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `batch-${date.toISOString().replace(/[:.]/g, '-')}.json`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, JSON.stringify(batchStats, null, 2));

  return filePath;
}

module.exports = { logBatch };