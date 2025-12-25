// Lightweight router CLI used by mcp_server to produce routing suggestions
const fs = require('fs');
const path = require('path');
const { decideRoute } = require('./lib/router');
const { writeSidecar } = require('./lib/sidecar');
const { computeFileHash } = require('../../tools/file_hash');
const { appendSeenEntry, getEntryByHash, ensureMetadataDir } = require('../../tools/seen_files');

// PROJECT_ROOT should point to repo root (two levels up from runtime/current)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const NAVI_CONFIG_PATH = path.join(PROJECT_ROOT, 'NAVI', 'config', 'routing_config.json');
let routingConfig = {};
try { routingConfig = JSON.parse(fs.readFileSync(NAVI_CONFIG_PATH, 'utf8')); } catch(e) { /* continue */ }

const NAVI_ROOT = process.env.NAVI_ROOT || routingConfig.navi_root || path.join(PROJECT_ROOT, 'NAVI');
// If a routing config exists under NAVI_ROOT, prefer it (this allows test overrides via NAVI_ROOT env)
const NAVI_CONFIG_OVERRIDE = path.join(NAVI_ROOT, 'config', 'routing_config.json');
try { if (fs.existsSync(NAVI_CONFIG_OVERRIDE)) routingConfig = JSON.parse(fs.readFileSync(NAVI_CONFIG_OVERRIDE, 'utf8')); } catch(e) { /* ignore */ }
const INBOX_DIR = path.join(NAVI_ROOT, 'inbox');

function sampleText(file) {
  try {
    const ext = path.extname(file).toLowerCase();
    // For text files, return content
    if (ext === '.txt' || ext === '.md') return fs.readFileSync(file, 'utf8').slice(0, 4096);

    // For PDFs and binaries, try to read a small raw buffer and coerce to text
    const buf = fs.readFileSync(file, { encoding: null, flag: 'r' });
    const text = buf.toString('utf8', 0, Math.min(buf.length, 16000)).replace(/\0/g, ' ');
    // Normalize whitespace and return a safe snippet
    return text.replace(/\s+/g, ' ').trim().slice(0, 8192);
  } catch (e) {
    // Fallback: filename
  }
  return path.basename(file);
}

const files = fs.existsSync(INBOX_DIR) ? fs.readdirSync(INBOX_DIR).map(f => path.join(INBOX_DIR, f)).filter(p => fs.statSync(p).isFile() && !p.toLowerCase().endsWith('.navi.json')) : [];
const out = { status: 'ok', batch_id: `BATCH-${Math.floor(Math.random()*9000)+1000}`, routed_files: [], routed_to: {}, files_routed: 0, auto_routed: 0, timestamp: new Date().toISOString() };
const { spawnSync } = require('child_process');

// CLI flags: --apply to enact moves; --dry-run to force dry-run; --limit N to only process N files
const argv = process.argv.slice(2);
const hasApply = argv.includes('--apply');
const hasDryRun = argv.includes('--dry-run');
const hasForce = argv.includes('--force');

// Safety: if both --apply and --dry-run are supplied, require explicit --force to proceed; with --force we allow the combo
// but we treat it as a dry-run (no moves) so tests can exercise the confirmation paths without making changes.
if (hasApply && hasDryRun && !hasForce) {
  console.error('Conflicting flags: both --apply and --dry-run were provided. Add --force to confirm you want to run this combination, or remove one of the flags.');
  process.exit(2);
}

let dryRun = true;
// If both --apply and --dry-run are present and --force is provided, allow the command but keep it as dry-run (do not move files).
if (hasApply && hasDryRun && hasForce) {
  dryRun = true;
} else if (hasApply) {
  dryRun = false;
} else if (hasDryRun) {
  dryRun = true;
} else if (routingConfig && routingConfig.enable_mailroom_routing) {
  dryRun = false; // config-driven
}

// parse --limit N or --limit=N
let limit = Infinity;
const limitArgIndex = argv.indexOf('--limit');
if (limitArgIndex !== -1 && argv[limitArgIndex+1]) {
  const v = parseInt(argv[limitArgIndex+1], 10);
  if (!Number.isNaN(v) && v > 0) limit = v;
} else {
  // support --limit=N
  const la = argv.find(a => a.startsWith('--limit='));
  if (la) {
    const v = parseInt(la.split('=')[1], 10);
    if (!Number.isNaN(v) && v > 0) limit = v;
  }
}

(async function main(){
  let processed = 0;
  for (const f of files) {
    if (processed >= limit) break;
    // If a sidecar exists and contains extracted text or detectedEntities, prefer it
    const sidecarPath = f + '.navi.json';
    let extractedText = null;
    let detectedEntities = [];
    try {
      if (fs.existsSync(sidecarPath)) {
        const sc = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
        if (sc && sc.extracted_text_snippet) extractedText = sc.extracted_text_snippet;
        if (sc && Array.isArray(sc.detectedEntities) && sc.detectedEntities.length>0) detectedEntities = sc.detectedEntities;
      }
    } catch (e) {
      // ignore and continue
    }

    if (!extractedText) extractedText = sampleText(f);

    // If we still don't have detectedEntities, try to call the helper detector to get candidates
    if ((!detectedEntities || detectedEntities.length===0) && extractedText && extractedText.length>10) {
      try {
        const detector = path.join(__dirname, 'tools', 'detect_entity_cli.js');
        const r = spawnSync('node', [detector], { input: extractedText, encoding: 'utf8', maxBuffer: 10*1024*1024 });
        if (r.status === 0 && r.stdout) {
          const parsed = JSON.parse(r.stdout);
          if (parsed && Array.isArray(parsed.detectedEntities)) detectedEntities = parsed.detectedEntities.map(d => ({ entity: d.entity, confidence: d.confidence }));
        }
      } catch (e) {
        // detector failed; continue
      }
    }

    const item = {
      filename: path.basename(f),
      extractedText: extractedText,
      detectedEntities: detectedEntities
    };

    // Compute content hash and check registry for duplicates (dedupe guard)
    const dedupeCfg = (routingConfig && routingConfig.dedupe) ? routingConfig.dedupe : { enabled: true, policy: 'flag' };
    try {
      if (dedupeCfg.enabled === false) {
        // Dedupe disabled; skip hashing/registry checks
      } else {
        ensureMetadataDir();
        const hash = await computeFileHash(f);
        const seen = getEntryByHash(hash);
        if (seen) {
          // Mark duplicate in routing object so it will appear in sidecar
          const decision = decideRoute(item, routingConfig);
          decision.routing = decision.routing || {};
          decision.routing.duplicate = true;
          decision.routing.duplicate_of = { hash: hash, first_seen: seen.first_seen, seen_path: seen.path };

          // Policy-driven behavior
          const policy = (dedupeCfg.policy || 'flag').toLowerCase();
          if (policy === 'skip') {
            // Mark route as skipped duplicate and avoid applying
            decision.route = 'mail_room.duplicate_skipped';
            decision.autoRoute = false;
            decision.routing.rule_id = 'DUPLICATE_SKIPPED_V1';
            decision.routing.rule_reason = 'Duplicate detected, policy=skip';
          } else if (policy === 'tag') {
            // Tag the routing with a reason code but otherwise act as flag
            decision.routing.reason_code = 'DUPLICATE_DETECTED';
          }

          // Add extracted text and detectedEntities to sidecar for auditability
          const scOut = Object.assign({ filename: item.filename, extracted_text_snippet: (item.extractedText||'').slice(0,16000), detectedEntities: item.detectedEntities }, decision);
          const sc = writeSidecar(f, scOut);

          const outEntry = { src: f, route: decision.route, autoRoute: decision.autoRoute, sidecar: sc };

          // If not dryRun and policy is not skip, attempt to apply
          if (!dryRun && policy !== 'skip') {
            try {
              const { applyRoute } = require(path.join(__dirname, 'lib', 'applier'));
              const applied = await applyRoute({ srcPath: f, sidecarPath: sc, route: decision.route, autoRoute: decision.autoRoute, dryRun: false, routingMeta: decision.routing, config: routingConfig });
              outEntry.applied = applied;
            } catch (err) {
              outEntry.error = (err && err.message) ? err.message : String(err);
            }
          }

          out.routed_files.push(outEntry);
          out.routed_to[decision.route] = (out.routed_to[decision.route] || 0) + 1;

          processed += 1;
          if (processed >= limit) break;

          continue;
        } else {
          // Not seen before — record and proceed
          await appendSeenEntry({ hash: hash, path: path.relative(NAVI_ROOT, f), filename: path.basename(f), first_seen: new Date().toISOString() });
        }
      }
    } catch (err) {
      // Hashing or registry failed — proceed without dedupe
    }

    const decision = decideRoute(item, routingConfig);

    // Add extracted text and detectedEntities to sidecar for auditability
    const scOut = Object.assign({ filename: item.filename, extracted_text_snippet: (item.extractedText||'').slice(0,16000), detectedEntities: item.detectedEntities }, decision);
    const sc = writeSidecar(f, scOut);

    const outEntry = { src: f, route: decision.route, autoRoute: decision.autoRoute, sidecar: sc };

    // If not dryRun, apply the route to the filesystem (move into office inboxes) - ensure sidecars never route independently
    if (!dryRun) {
      try {
        const safeRoute = String(decision.route || '').toUpperCase();
        // Normalize route: if it's a function-only like 'CFO' or 'EXEC' it's OK; otherwise, route is an office name per resolveDestination
        const { applyRoute } = require(path.join(__dirname, 'lib', 'applier'));
        const applied = await applyRoute({ srcPath: f, sidecarPath: sc, route: decision.route, autoRoute: decision.autoRoute, dryRun: false, routingMeta: decision.routing, config: routingConfig });
        outEntry.applied = applied;
      } catch (err) {
        outEntry.error = (err && err.message) ? err.message : String(err);
      }
    }

    out.routed_files.push(outEntry);
    out.routed_to[decision.route] = (out.routed_to[decision.route] || 0) + 1;
    out.files_routed = (out.files_routed || 0) + 1;
    if (decision.autoRoute) out.auto_routed = (out.auto_routed || 0) + 1;

    // increment processed count and respect limit
    processed += 1;
    if (processed >= limit) break;
  }

  // Finalize timestamp
  out.timestamp = new Date().toISOString();

  // Output JSON-only to stdout
  process.stdout.write(JSON.stringify(out) + '\n');
})();