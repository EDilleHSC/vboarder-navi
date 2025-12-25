const express = require('express');
const path = require('path');
const morgan = require('morgan');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 8005;
const presenterDir = path.join(__dirname, '..', 'presenter');
const logDir = path.join(__dirname, '..', 'logs');

// Ensure log dir exists
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
let accessLogStream;
try {
  accessLogStream = fs.createWriteStream(path.join(logDir, 'presenter.log'), { flags: 'a' });
  accessLogStream.on('error', (e) => { console.warn('[SERVER] presenter.log write error', e && e.message); });
} catch (e) {
  console.warn('[SERVER] presenter.log locked/unavailable, falling back to console logging');
  accessLogStream = null;
}

// Morgan: write both to console and to file (if file available)
if (accessLogStream) {
  app.use(morgan('combined', { stream: accessLogStream }));
} else {
  app.use(morgan('combined'));
}
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));

// Redirect legacy design-approval to mail-room (catch multiple legacy paths)
app.get(['/presenter/design-approval.html', '/presenter/design-approval', '/design-approval.html', '/design-approval'], (req, res) => {
  console.log('[REDIRECT] design-approval -> mail-room');
  accessLogStream.write(`[REDIRECT] ${new Date().toISOString()} ${req.method} ${req.url}\n`);
  res.redirect(302, '/presenter/mail-room.html');
});

// Serve static files under /presenter (serve index.html for root)
app.use('/presenter', express.static(presenterDir, { index: 'index.html' }));
// Ensure a direct request to /presenter or /presenter/ returns the index
app.get(['/presenter', '/presenter/'], (req, res) => res.sendFile(path.join(presenterDir, 'index.html')));

// View engine for server-side render (EJS)
app.set('views', presenterDir);
app.set('view engine', 'ejs');

// Health - include listen info when available
const serverInfo = { bound: false, address: null, port: null };
app.get('/health', (req, res) => res.json({ status: 'ok', servedFrom: presenterDir, server: serverInfo }));

// Endpoint to receive client-side logs
app.post('/presenter/client-log', express.json({ limit: '64kb' }), (req, res) => {
  const entry = req.body || {};
  const msg = `[CLIENT_LOG] ${new Date().toISOString()} ${entry.level || 'log'} ${entry.message || ''} ${entry.meta ? JSON.stringify(entry.meta) : ''}\n`;
  console.log(msg.trim());
  try { fs.appendFileSync(path.join(logDir, 'presenter.log'), msg); } catch (e) {}
  res.status(204).end();
});

// --- Package API endpoints ---
// List packages
app.get('/api/packages', (req, res) => {
  try {
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    if (!fs.existsSync(packagesDir)) return res.json([]);
    const pkgs = fs.readdirSync(packagesDir).filter(n => fs.statSync(path.join(packagesDir, n)).isDirectory()).map(name => {
      const p = path.join(packagesDir, name);
      const stat = fs.statSync(p);
      // count files (exclude manifest/README)
      const files = fs.readdirSync(p).filter(f => !f.toLowerCase().endsWith('.md') && !f.toLowerCase().endsWith('.csv'));
      return { name, createdAt: stat.mtime.toISOString(), fileCount: files.length };
    }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    return res.json(pkgs);
  } catch (err) {
    console.error('[API] /api/packages error', err);
    return res.status(500).json({ error: 'failed to list packages' });
  }
});

// List files in a package
app.get('/api/packages/:pkg/files', (req, res) => {
  try {
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    const pkgDir = path.join(packagesDir, req.params.pkg);
    if (!fs.existsSync(pkgDir)) return res.status(404).json({ error: 'package not found' });
    const files = fs.readdirSync(pkgDir).filter(n => !n.toLowerCase().endsWith('.md') && !n.toLowerCase().endsWith('.csv'));
    const out = files.filter(n => !n.endsWith('.navi.json') && !n.endsWith('.meta.json')).map(filename => {
      const naviPath = path.join(pkgDir, filename + '.navi.json');
      let navi = null;
      try { if (fs.existsSync(naviPath)) navi = JSON.parse(fs.readFileSync(naviPath, 'utf8')); } catch(e) { /* ignore */ }
      return {
        filename,
        route: (navi && navi.route) || 'unknown',
        applied_at: (navi && navi.routing && navi.routing.applied_at) || (navi && navi.generated_at) || null,
        snippet: (navi && navi.extracted_text_snippet) ? (navi.extracted_text_snippet.slice(0, 200)) : null
      };
    });
    return res.json(out);
  } catch (err) {
    console.error('[API] /api/packages/:pkg/files error', err);
    return res.status(500).json({ error: 'failed to list package files' });
  }
});

// Return full sidecar for a file
app.get('/api/packages/:pkg/files/:filename', (req, res) => {
  try {
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    const pkgDir = path.join(packagesDir, req.params.pkg);
    const naviPath = path.join(pkgDir, req.params.filename + '.navi.json');
    const metaPath = path.join(pkgDir, req.params.filename + '.meta.json');
    const out = {};
    if (fs.existsSync(naviPath)) out.navi = JSON.parse(fs.readFileSync(naviPath, 'utf8'));
    if (fs.existsSync(metaPath)) out.meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return res.json(out);
  } catch (err) {
    console.error('[API] /api/packages/:pkg/files/:filename error', err);
    return res.status(500).json({ error: 'failed to read sidecars' });
  }
});

// Package download (zip on demand) with caching and eviction
const zipCreationLocks = new Map(); // pkgName -> Promise
const ZIP_CACHE_TTL_MS = parseInt(process.env.ZIP_CACHE_TTL_MS, 10) || 24 * 60 * 60 * 1000; // default 24 hours
const ZIP_CACHE_MAX_BYTES = parseInt(process.env.ZIP_CACHE_MAX_BYTES, 10) || (500 * 1024 * 1024); // default 500MB

function pruneZipCache(packagesDir, excludePath) {
  try {
    const zipFiles = fs.readdirSync(packagesDir).filter(f => f.endsWith('.zip')).map(f => path.join(packagesDir, f)).filter(p => fs.existsSync(p));
    // compute total size and sort by mtime ascending (oldest first)
    const entries = zipFiles.map(p => ({ path: p, size: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs })).sort((a,b) => a.mtime - b.mtime);
    let total = entries.reduce((s, e) => s + e.size, 0);
    // evict by age (TTL) first
    const now = Date.now();
    entries.forEach(e => {
      if (e.path !== excludePath && (now - e.mtime) > ZIP_CACHE_TTL_MS) {
        try { fs.unlinkSync(e.path); total -= e.size; console.log('[CACHE] evicted old zip', e.path); } catch (e) {}
      }
    });
    // If still over size, evict oldest until under limit (excluding excludePath)
    for (const e of entries) {
      if (total <= ZIP_CACHE_MAX_BYTES) break;
      if (e.path === excludePath) continue;
      try { fs.unlinkSync(e.path); total -= e.size; console.log('[CACHE] evicted zip for size', e.path); } catch (err) {}
    }
  } catch (err) {
    console.error('[CACHE] prune error', err);
  }
}

app.get('/api/packages/:pkg/download', async (req, res) => {
  try {
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    const pkgName = req.params.pkg;
    const pkgDir = path.join(packagesDir, pkgName);
    console.log(`[API] download requested pkg=${pkgName} pkgDir=${pkgDir} exists=${fs.existsSync(pkgDir)}`);
    if (!fs.existsSync(pkgDir) || !fs.statSync(pkgDir).isDirectory()) return res.status(404).json({ error: 'package not found' });

    const zipPath = path.join(packagesDir, `${pkgName}.zip`);

    // helper: get latest mtime of files in package dir
    function getDirMaxMtime(dir) {
      const files = fs.readdirSync(dir).map(f => path.join(dir, f)).filter(p => fs.existsSync(p)).map(p => fs.statSync(p).mtimeMs);
      return files.length ? Math.max(...files) : 0;
    }

    const dirMax = getDirMaxMtime(pkgDir);
    if (fs.existsSync(zipPath) && fs.statSync(zipPath).mtimeMs >= dirMax && (Date.now() - fs.statSync(zipPath).mtimeMs) <= ZIP_CACHE_TTL_MS) {
      // cached zip is fresh; stream it
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${pkgName}.zip"`);
      const rs = fs.createReadStream(zipPath);
      rs.on('error', err => { console.error('[API] zip stream error', err); try { res.status(500).end(); } catch (e) {} });
      return rs.pipe(res);
    }

    // If a zip is already being created for this package, wait for it
    if (zipCreationLocks.has(pkgName)) {
      await zipCreationLocks.get(pkgName);
      // then stream cached file
      if (fs.existsSync(zipPath)) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${pkgName}.zip"`);
        return fs.createReadStream(zipPath).pipe(res);
      }
    }

    // Acquire lock and create zip to temp, stream concurrently
    let resolveLock;
    const lockPromise = new Promise((resolve) => { resolveLock = resolve; });
    zipCreationLocks.set(pkgName, lockPromise);

    const archiver = require('archiver');
    const tmpZip = zipPath + '.tmp';

    // pipe archive to both a file and response
    const output = fs.createWriteStream(tmpZip);
    output.on('error', err => console.error('[API] zip write error', err));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pkgName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { console.error('[API] zip error', err); try { res.status(500).end(); } catch (e) {} });
    archive.pipe(output);
    archive.pipe(res);
    archive.directory(pkgDir, false);

    archive.finalize().then(() => {
      try { fs.renameSync(tmpZip, zipPath); } catch (e) { console.error('[API] rename zip error', e); }
      // prune cache after successful create (don't delete the newly created file)
      pruneZipCache(packagesDir, zipPath);
      resolveLock();
      zipCreationLocks.delete(pkgName);
    }).catch((err) => {
      console.error('[API] archive finalize error', err);
      try { res.end(); } catch(e){}
      resolveLock();
      zipCreationLocks.delete(pkgName);
    });

  } catch (err) {
    console.error('[API] /api/packages/:pkg/download error', err);
    return res.status(500).json({ error: 'failed to create package zip' });
  }
});

// Purge cached zip for a package
app.post('/api/packages/:pkg/cache/purge', (req, res) => {
  try {
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    const zipPath = path.join(packagesDir, `${req.params.pkg}.zip`);
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
      return res.status(204).end();
    }
    return res.status(404).json({ error: 'cached zip not found' });
  } catch (err) {
    console.error('[API] /api/packages/:pkg/cache/purge error', err);
    return res.status(500).json({ error: 'failed to purge cache' });
  }
});

// Cache status endpoint — lists cached zips and metadata
app.get('/api/packages/cache/status', (req, res) => {
  try {
    const packagesRoot = path.join(__dirname, '..', 'NAVI', 'packages');
    if (!fs.existsSync(packagesRoot)) return res.json([]);
    const entries = new Map();

    // include package directories
    const dirents = fs.readdirSync(packagesRoot, { withFileTypes: true });
    dirents.forEach(d => {
      if (d.isDirectory()) {
        entries.set(d.name, { pkgName: d.name, pkgDir: path.join(packagesRoot, d.name), zipPath: path.join(packagesRoot, `${d.name}.zip`) });
      }
    });

    // include zip files even if package dir missing
    dirents.filter(d => d.isFile() && d.name.endsWith('.zip')).forEach(z => {
      const pkgName = z.name.replace(/\.zip$/, '');
      if (!entries.has(pkgName)) entries.set(pkgName, { pkgName, pkgDir: path.join(packagesRoot, pkgName), zipPath: path.join(packagesRoot, z.name) });
    });

    const now = Date.now();
    const out = [];
    for (const e of entries.values()) {
      try {
        const zipExists = fs.existsSync(e.zipPath);
        const zipStat = zipExists ? fs.statSync(e.zipPath) : null;
        let latestFileMtime = 0;
        if (fs.existsSync(e.pkgDir)) {
          const files = fs.readdirSync(e.pkgDir).map(n => fs.statSync(path.join(e.pkgDir, n)).mtimeMs);
          latestFileMtime = files.length ? Math.max(...files) : 0;
        }
        const isLocked = zipCreationLocks.has(e.pkgName);
        const status = zipExists ? (zipStat.mtimeMs >= latestFileMtime ? 'valid' : 'stale') : 'missing';
        const ttlRemainingSeconds = zipExists ? Math.max(0, Math.floor(((ZIP_CACHE_TTL_MS - (now - zipStat.mtimeMs)) / 1000))) : null;
        out.push({
          pkgName: e.pkgName,
          zipPath: path.relative(process.cwd(), e.zipPath),
          zipSizeBytes: zipExists ? zipStat.size : 0,
          zipMtime: zipExists ? new Date(zipStat.mtimeMs).toISOString() : null,
          packageLatestFileMtime: latestFileMtime ? new Date(latestFileMtime).toISOString() : null,
          status,
          ttlRemainingSeconds,
          locked: !!isLocked
        });
      } catch (err) { console.warn('cache status read error', err); }
    }

    return res.json(out.sort((a,b) => (b.zipMtime||'').localeCompare(a.zipMtime||'')));
  } catch (err) {
    console.error('[API] /api/packages/cache/status error', err);
    return res.status(500).json({ error: 'failed to read cache status' });
  }
});

// --- Batch & Package report endpoints ---
// Return a batch summary for packages matching a batchId (substring match)
app.get('/api/packages/batch_summary/:batchId', (req, res) => {
  try {
    const batchId = req.params.batchId;
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    if (!fs.existsSync(packagesDir)) return res.status(404).json({ error: 'no packages root' });
    const pkgNames = fs.readdirSync(packagesDir).filter(n => fs.statSync(path.join(packagesDir, n)).isDirectory());
    const matched = pkgNames.filter(n => n.includes(batchId));
    const packages = matched.map(name => {
      const pdir = path.join(packagesDir, name);
      const stat = fs.statSync(pdir);
      const files = fs.readdirSync(pdir).filter(f => !f.toLowerCase().endsWith('.md') && !f.toLowerCase().endsWith('.csv') && !f.endsWith('.navi.json') && !f.endsWith('.meta.json'));
      const size = files.reduce((s, f) => { try { return s + fs.statSync(path.join(pdir, f)).size } catch(e){ return s } }, 0);
      return { id: name, folder: name, files: files.length, sizeBytes: size, createdAt: stat.mtime.toISOString() };
    });
    return res.json({ batchId, count: packages.length, packages });
  } catch (err) {
    console.error('[API] /api/packages/batch_summary/:batchId error', err);
    return res.status(500).json({ error: 'failed to build batch summary' });
  }
});

// Package report: README, files, and related audit entries (filtered by package)
app.get('/api/packages/:pkg/report', (req, res) => {
  try {
    const pkg = req.params.pkg;
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    const pkgDir = path.join(packagesDir, pkg);
    if (!fs.existsSync(pkgDir) || !fs.statSync(pkgDir).isDirectory()) return res.status(404).json({ error: 'package not found' });

    // README: prefer README.txt then README.md
    let readme = null;
    const readmeTxt = path.join(pkgDir, 'README.txt');
    const readmeMd = path.join(pkgDir, 'README.md');
    if (fs.existsSync(readmeTxt)) readme = fs.readFileSync(readmeTxt, 'utf8');
    else if (fs.existsSync(readmeMd)) readme = fs.readFileSync(readmeMd, 'utf8');

    // Files list with basic sidecar info
    const files = fs.readdirSync(pkgDir).filter(n => !n.toLowerCase().endsWith('.md') && !n.toLowerCase().endsWith('.csv') && !n.endsWith('.navi.json') && !n.endsWith('.meta.json')).map(filename => {
      const naviPath = path.join(pkgDir, filename + '.navi.json');
      let navi = null;
      try { if (fs.existsSync(naviPath)) navi = JSON.parse(fs.readFileSync(naviPath, 'utf8')); } catch(e) { /* ignore */ }
      return { filename, route: (navi && navi.route) || 'unknown', delivered: !!(navi && navi.delivered) };
    });

    // Audit entries: read NAVI/approvals/audit.log (line-delimited JSON) and filter by package or file path
    const approvalsDir = path.join(__dirname, '..', 'NAVI', 'approvals');
    const auditLog = path.join(approvalsDir, 'audit.log');
    const audits = [];
    if (fs.existsSync(auditLog)) {
      const lines = fs.readFileSync(auditLog, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        try {
          const obj = JSON.parse(ln);
          // filter heuristics: package field matches, or file path contains package name
          if ((obj.package && obj.package === pkg) || (obj.file && obj.file.indexOf(pkg) !== -1) || (obj.to && obj.to.indexOf(pkg) !== -1)) audits.push(obj);
        } catch(e) { /* ignore unparsable */ }
      }
    }

    // Build per-file audit timelines
    const fileTimelines = {};
    for (const f of files) fileTimelines[f.filename] = [];
    for (const a of audits) {
      const candidate = (a.file || a.target || a.to || a.path || '');
      for (const fname of Object.keys(fileTimelines)) {
        if (!candidate) continue;
        if (typeof candidate === 'string' && (candidate.endsWith(fname) || candidate.indexOf(fname) !== -1 || (a.file && a.file.indexOf(fname) !== -1))) {
          fileTimelines[fname].push(a);
        }
      }
    }
    // sort timelines by timestamp descending (best-effort on common fields)
    const sortByTsDesc = (arr) => arr.sort((x,y) => {
      const tx = x.timestamp || x.time || x.ts || x.at || null;
      const ty = y.timestamp || y.time || y.ts || y.at || null;
      const dx = tx ? new Date(tx).getTime() : 0;
      const dy = ty ? new Date(ty).getTime() : 0;
      return (dy - dx);
    });
    for (const k of Object.keys(fileTimelines)) sortByTsDesc(fileTimelines[k]);

    return res.json({ package: pkg, readme, files, audits, fileTimelines });
  } catch (err) {
    console.error('[API] /api/packages/:pkg/report error', err);
    return res.status(500).json({ error: 'failed to build package report' });
  }
});

// Server-rendered packages report page (EJS)
app.get('/presenter/packages_report', (req, res) => {
  const batchId = req.query.batch || '';
  // replicate batch summary logic
  try {
    const packagesDir = path.join(__dirname, '..', 'NAVI', 'packages');
    let packages = [];
    if (fs.existsSync(packagesDir)) {
      const pkgNames = fs.readdirSync(packagesDir).filter(n => fs.statSync(path.join(packagesDir, n)).isDirectory());
      const matched = batchId ? pkgNames.filter(n => n.includes(batchId)) : pkgNames.sort((a,b) => b.localeCompare(a)).slice(0, 50);
      packages = matched.map(name => {
        const pdir = path.join(packagesDir, name);
        const stat = fs.statSync(pdir);
        const files = fs.readdirSync(pdir).filter(f => !f.toLowerCase().endsWith('.md') && !f.toLowerCase().endsWith('.csv') && !f.endsWith('.navi.json') && !f.endsWith('.meta.json'));
        const size = files.reduce((s, f) => { try { return s + fs.statSync(path.join(pdir, f)).size } catch(e){ return s } }, 0);
        return { id: name, folder: name, files: files.length, sizeBytes: size, createdAt: stat.mtime.toISOString() };
      });
    }
    res.render('packages_report', { batchId, packages });
  } catch (err) {
    console.error('[VIEW] /presenter/packages_report error', err);
    res.status(500).send('Failed to render packages report');
  }
});

// Expose approvals audit as JSON (parse newline-delimited JSON and legacy lines)
app.get('/approvals/audit', (req, res) => {
  try {
    const approvalsDir = path.join(__dirname, '..', 'NAVI', 'approvals');
    const auditPath = path.join(approvalsDir, 'audit.log');
    if (!fs.existsSync(auditPath)) return res.status(404).json({ error: 'audit log not found' });
    const data = fs.readFileSync(auditPath, 'utf8');
    const lines = data.split(/\r?\n/).filter(Boolean);
    const parsed = lines.map(line => {
      try { return JSON.parse(line); } catch (e) {
        const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (m) return { legacy: true, timestamp: m[1], message: m[2], raw: line };
        return { legacy: true, raw: line };
      }
    });
    // sort by timestamp if present (desc)
    parsed.sort((a,b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });

    // pagination
    const total = parsed.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(200, Math.max(1, parseInt(req.query.per_page, 10) || 200));
    const start = (page - 1) * per_page;
    const entries = parsed.slice(start, start + per_page);

    return res.json({ total, page, per_page, entries });
  } catch (err) {
    console.error('[API] /approvals/audit error', err);
    return res.status(500).json({ error: 'failed to read audit log' });
  }
});

// Expose presenter runtime config for front-end (e.g., read-only / allow_approvals)
app.get('/presenter/config', (req, res) => {
  try {
    const cfgPath = path.join(__dirname, '..', 'config.json');
    let cfg = {};
    if (fs.existsSync(cfgPath)) {
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { /* ignore parse errors */ }
    }
    return res.json({ presenter: (cfg.presenter || { allow_approvals: true, read_only_mode: false }) });
  } catch (err) {
    console.error('[API] /presenter/config error', err);
    return res.status(500).json({ error: 'failed to read config' });
  }
});

// Catch-all redirect for root to presenter index (default observation summary)
app.get('/', (req, res) => res.redirect(302, '/presenter/index.html'));

// Crash / error handlers: capture uncaught errors to the log file
process.on('uncaughtException', (err) => {
  const msg = `[UNCAUGHT_EXCEPTION] ${new Date().toISOString()} ${err && err.stack ? err.stack : String(err)}\n`;
  console.error(msg);
  try { fs.appendFileSync(path.join(logDir, 'presenter.log'), msg); } catch (e) {}
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const msg = `[UNHANDLED_REJECTION] ${new Date().toISOString()} ${reason}\n`;
  console.error(msg);
  try { fs.appendFileSync(path.join(logDir, 'presenter.log'), msg); } catch (e) {}
});

let server = null;

// Helper to attempt listen with fallback ports/addresses
function tryListenOnce(address, p) {
  return new Promise((resolve, reject) => {
    const s = app.listen(p, address, () => {
      try {
        const addr = s.address();
        serverInfo.bound = true;
        serverInfo.address = addr.address;
        serverInfo.port = addr.port;
        serverInfo.started_at = new Date().toISOString();
        serverInfo.pid = process.pid;
        const hostDisplay = (addr.address === '0.0.0.0') ? '0.0.0.0' : addr.address;
        const msg = `Presenter server listening on http://${hostDisplay}:${addr.port}/presenter/ at ${serverInfo.started_at}\n`;
        console.log(msg);
        try { accessLogStream.write(msg); } catch (e) {}

        // Optionally write a small run_start.json to NAVI/approvals for external discovery
        if (process.env.WRITE_PORT_FILE && process.env.WRITE_PORT_FILE !== '0') {
          try {
            const runStartPath = path.join(__dirname, '..', 'NAVI', 'approvals', 'run_start.json');
            fs.mkdirSync(path.dirname(runStartPath), { recursive: true });
            const payload = { port: addr.port, address: addr.address, started_at: serverInfo.started_at, pid: serverInfo.pid };
            fs.writeFileSync(runStartPath, JSON.stringify(payload, null, 2), 'utf8');
            console.log('[SERVER] wrote run_start.json', runStartPath);
          } catch (e) {
            console.warn('[SERVER] failed to write run_start.json', e && e.message);
          }
        }

      } catch (e) { /* ignore */ }
      resolve(s);
    });
    s.on('error', (err) => reject(err));
  });
}

async function startServerWithFallback() {
  const basePort = parseInt(process.env.PORT, 10) || parseInt(process.env.PORT_8005, 10) || 8005;
  const maxAttempts = Math.max(1, parseInt(process.env.PORT_FALLBACK_ATTEMPTS, 10) || 6);
  const failOnConflict = !!(process.env.FAIL_ON_PORT_CONFLICT && process.env.FAIL_ON_PORT_CONFLICT !== '0');
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tryPort = basePort + attempt;
    const addrs = (attempt === 0) ? ['0.0.0.0', '127.0.0.1'] : ['127.0.0.1'];
    for (const addr of addrs) {
      try {
        server = await tryListenOnce(addr, tryPort);
        // attach error handler so tests won't crash on later errors
        server.on('error', (err) => {
          if (err && err.code === 'EADDRINUSE') {
            console.warn('[SERVER] address in use; continuing without listening:', err.message);
          } else {
            console.error('[SERVER] server error', err);
          }
        });
        // Export the live server for test harnesses that import this module
        try { module.exports.__testServer = server; } catch (e) { /* ignore */ }
        return server;
      } catch (err) {
        lastErr = err;
        if (err && err.code === 'EADDRINUSE') {
          const msg = `[SERVER] EADDRINUSE trying ${addr}:${tryPort} (${err.message})`;
          if (failOnConflict) {
            console.error(msg + ' - FAIL_ON_PORT_CONFLICT set; exiting.');
            process.exit(1);
          }
          console.warn(msg);
          continue;
        } else {
          console.error('[SERVER] listen error', err && err.stack ? err.stack : err);
          break;
        }
      }
    }
  }
  if (!server) {
    if (lastErr && lastErr.code === 'EADDRINUSE') {
      console.warn('[SERVER] all fallback attempts failed; continuing without listening', lastErr.message);
    } else {
      console.error('[SERVER] failed to start server', lastErr);
    }
    // Return the express app so unit tests that use supertest(request(app)) can
    // still exercise routes even when the server failed to bind (e.g., port in use).
    return app;
  }
  return server;
}

// Auto-start only when run directly
if (require.main === module) {
  startServerWithFallback().catch(err => {
    console.error('[SERVER] failed to start (main):', err);
    process.exit(1);
  });
}

// Graceful shutdown
function shutdown() {
  console.log('[SHUTDOWN] stopping presenter server');
  try { accessLogStream.end(); } catch (e) {}
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Export app and control helpers for tests
module.exports = app;
module.exports.startServer = startServerWithFallback;
module.exports.stopServer = async () => {
  if (server && server.close) {
    return new Promise((resolve, reject) => {
      let done = false;
      try {
        const timer = setTimeout(() => {
          if (!done) {
            try { server && server.close && server.close(() => {}); } catch (e) { /* ignore */ }
            serverInfo.bound = false; serverInfo.started_at = null; serverInfo.pid = null; server = null; resolve();
          }
        }, 2000);
        server.close(() => { done = true; clearTimeout(timer); serverInfo.bound = false; serverInfo.started_at = null; serverInfo.pid = null; server = null; resolve(); });
      } catch (e) { server = null; resolve(); }
    });
  }
  return Promise.resolve();
};
// Default test export: provide the Express app so supertest(request(app)) works when the
// module is required in unit tests. If the server is later started, startServerWithFallback
// will update this to the live server instance above.
module.exports.__testServer = app;
