const fs = require('fs');
const path = require('path');

function makeSidecarPath(filePath) {
  return filePath + '.navi.json';
}

function writeSidecar(filePath, metadata) {
  const scPath = makeSidecarPath(filePath);
  const payload = Object.assign({ generated_at: new Date().toISOString() }, metadata);
  fs.writeFileSync(scPath, JSON.stringify(payload, null, 2), 'utf8');
  return scPath;
}

module.exports = { makeSidecarPath, writeSidecar }