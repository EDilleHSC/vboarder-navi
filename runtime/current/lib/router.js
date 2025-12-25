const fs = require('fs');
const path = require('path');

function normalizeText(s) {
  return (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
}

function guessDocType(filename, extractedText, routingConfig) {
  const name = (filename || '').toLowerCase();
  for (const dt of Object.keys(routingConfig.doc_type_to_function || {})) {
    if (name.includes(dt) || (extractedText || '').toLowerCase().includes(dt)) return dt;
  }
  // fallback heuristics
  if (name.match(/\.pdf$|\.docx?$|\.txt$/)) {
    const txt = (extractedText || '').toLowerCase();
    if (txt.includes('invoice') || name.includes('invoice')) return 'invoice';
    if (txt.includes('bill') || name.includes('bill')) return 'bill';
    if (txt.includes('receipt') || name.includes('receipt')) return 'receipt';
    if (txt.includes('contract') || name.includes('contract')) return 'contract';
  }
  return null;
}

function matchEntity(extractedText, routingConfig) {
  const text = normalizeText(extractedText);
  // Prefer explicit entity_signals map if present (names/addresses)
  const signals = routingConfig.entity_signals || {};

  // 1) Check for NAME/KEYWORD matches first across all entities and pick best (longest) match
  let bestNameMatch = null; // { id, name }
  for (const id of Object.keys(signals)) {
    const s = signals[id] || {};
    // collect candidate textual signals: singular 'name', array 'names', and 'keywords'
    const candidates = [];
    if (s.name) candidates.push(s.name);
    if (Array.isArray(s.names)) candidates.push(...s.names);
    if (Array.isArray(s.keywords)) candidates.push(...s.keywords);
    for (const n of candidates) {
      if (n && text.includes(n.toLowerCase())) {
        if (!bestNameMatch || n.length > bestNameMatch.name.length) bestNameMatch = { id, name: n };
      }
    }
  }
  if (bestNameMatch) return bestNameMatch.id;

  // 2) If no name matches, check addresses and pick the first match (addresses are less specific)
  for (const id of Object.keys(signals)) {
    const s = signals[id] || {};
    const addresses = s.addresses || [];
    for (const a of addresses) {
      if (a && text.includes(a.toLowerCase())) return id;
    }
  }
  // 3) Tokenized word match against known aliases (names, addresses, or extra signals)
  const tokenized = text.split(/\W+/).filter(Boolean);
  for (const id of Object.keys(signals)) {
    const s = signals[id] || {};
    const aliases = [];
    if (Array.isArray(s.names)) aliases.push(...s.names.map(x => x.toLowerCase()));
    if (Array.isArray(s.addresses)) aliases.push(...s.addresses.map(x => x.toLowerCase()));
    if (Array.isArray(s.signals)) aliases.push(...s.signals.map(x => x.toLowerCase()));
    for (const alias of aliases) {
      if (alias && tokenized.includes(alias)) return id;
    }
  }
  // Backward-compatible: some configs may nest signals under routingConfig.entities[id].signals
  if (routingConfig.entities) {
    // Try name matches in nested signals
    bestNameMatch = null;
    for (const id of Object.keys(routingConfig.entities)) {
      const e = routingConfig.entities[id];
      const names = (e.signals && e.signals.names) || [];
      for (const n of names) {
        if (n && text.includes(n.toLowerCase())) {
          if (!bestNameMatch || n.length > bestNameMatch.name.length) bestNameMatch = { id, name: n };
        }
      }
    }
    if (bestNameMatch) return bestNameMatch.id;

    // Then addresses
    for (const id of Object.keys(routingConfig.entities)) {
      const e = routingConfig.entities[id];
      const addresses = (e.signals && e.signals.addresses) || [];
      for (const a of addresses) {
        if (a && text.includes(a.toLowerCase())) return id;
      }
    }
  }

  return null;
}

function detectFunction(text, routingConfig) {
  const txt = normalizeText(text);
  // First preference: new-style intent_definitions with keywords
  if (routingConfig && routingConfig.intent_definitions) {
    for (const [intentName, def] of Object.entries(routingConfig.intent_definitions || {})) {
      const keywords = def.keywords || [];
      for (const kw of keywords) {
        if (kw && txt.includes(kw.toLowerCase())) return { function: intentName, reason: `Intent keyword: ${kw}` };
      }
    }
  }

  // Backward compatible: keywords_to_function mapping
  if (routingConfig && routingConfig.keywords_to_function) {
    for (const [func, keywords] of Object.entries(routingConfig.keywords_to_function || {})) {
      for (const kw of keywords) {
        if (kw && txt.includes(kw.toLowerCase())) return { function: func, reason: `Keyword: ${kw}` };
      }
    }
  }

  return { function: null, reason: 'No function keywords matched' };
}

function decideRoute(item, routingConfig) {
  // New simplified routing per v2.0: intent-driven, no holds, no review_required, entity metadata-only
  // item: { filename, extractedText, detectedEntities: [{entity, confidence}], length, path }
  const extractedText = item.extractedText || '';

  // Determine intent (function in previous code)
  let intent = null;
  const docType = guessDocType(item.filename, extractedText, routingConfig);
  if (docType) {
    if (routingConfig.doc_type_to_function && routingConfig.doc_type_to_function[docType]) {
      intent = routingConfig.doc_type_to_function[docType];
    } else {
      // Fallback mapping when explicit doc_type_to_function is not configured
      const fallbackDocMap = { invoice: 'Finance', bill: 'Finance', receipt: 'Finance', contract: 'Legal' };
      if (fallbackDocMap[docType]) intent = fallbackDocMap[docType];
    }
  }
  if (!intent) {
    const df = detectFunction(extractedText, routingConfig);
    if (df && df.function) intent = df.function;
  }

  // Top AI entity confidence (metadata only)
  const detected = Array.isArray(item.detectedEntities) ? item.detectedEntities.slice().sort((a,b)=> (b.confidence||0)-(a.confidence||0)) : [];
  const top = detected[0] || null; // {entity, confidence}
  const topConf = top ? (top.confidence || 0) : 0; // float 0..1

  // Use entity matching from text (metadata-only) if present; textual entity drives entity-scoped routes.
  const textEntity = matchEntity(extractedText, routingConfig);
  // Keep detected entity for metadata reporting, but do NOT use it to create entity-scoped routes
  const detectedEntity = (top && top.entity) || null;

  // Threshold from canonical routing_config
  const threshold = (routingConfig && routingConfig.confidence && typeof routingConfig.confidence.auto_route_threshold === 'number') ? routingConfig.confidence.auto_route_threshold : 70;

  // Resolve destination
  function resolveDestination({ intent, confidence, config }) {
    const t = config && config.confidence && typeof config.confidence.auto_route_threshold === 'number' ? config.confidence.auto_route_threshold : 70;
    if (!intent || (confidence * 100) < t) {
      return {
        destination: 'EXEC',
        autoRouted: false,
        reason: 'low_confidence_or_unknown_intent'
      };
    }

    return {
      destination: (config.intent_definitions && config.intent_definitions[intent] && config.intent_definitions[intent].office) || 'EXEC',
      autoRouted: true,
      reason: 'intent_match'
    };
  }

  // Insurance filename heuristic: when extracted text is missing or confidence is below threshold,
  // use filename/vendor signals for narrow insurance cases to route to CFO.
  const fileLower = (item && item.filename) ? item.filename.toLowerCase() : '';
  const insuranceKeywords = ['insurance','policy','premium','progressive','statefarm','geico','allstate'];
  const lowConfidence = !top || ((topConf||0) * 100) < ((routingConfig && routingConfig.confidence && typeof routingConfig.confidence.auto_route_threshold === 'number') ? routingConfig.confidence.auto_route_threshold : 70);
  const textEmpty = !(item.extractedText && item.extractedText.trim() && item.extractedText.trim().length >= 10);
  if ((textEmpty || lowConfidence) && insuranceKeywords.some(k => fileLower.includes(k))) {
    // Force Finance -> CFO with a clear heuristic reason
    const routing = { rule_id: 'INSURANCE_FILENAME_HEURISTIC_V1', rule_reason: 'filename_insurance_heuristic' };
    return {
      entity: (top && top.entity) || null,
      entityConfidence: Math.round((topConf||0) * 100),
      function: 'Finance',
      route: 'CFO',
      confidence: Math.round((topConf||0) * 100),
      autoRoute: true,
      reasons: ['heuristic_filename_insurance'],
      routing
    };
  }

  const res = resolveDestination({ intent: intent, confidence: topConf, config: routingConfig });

  // routing meta for auditability
  const routing = {
    rule_id: 'ROUTING_V2',
    rule_reason: res.reason
  };

  // If a textual entity was resolved, prefer an entity-scoped route (e.g., 'LHI.Finance'), otherwise use function-level destination (e.g., 'CFO' or 'EXEC')
  const finalRoute = (textEntity && intent) ? `${textEntity}.${intent}` : res.destination;

  return {
    // Prefer textual entity extracted from content for reporting when present, otherwise report detected entity metadata
    entity: textEntity || detectedEntity || null,
    entityConfidence: Math.round((topConf||0) * 100),
    function: intent || null,
    route: finalRoute,
    confidence: Math.round((topConf||0) * 100),
    autoRoute: res.autoRouted,
    reasons: [res.reason],
    routing
  };
}

function getPathsForRoute(route, routingConfig) {
  // route like 'DDM.Finance' or 'mail_room.review_required'
  const rp = routingConfig.route_paths || {};
  const fp = routingConfig.function_to_office || {};
  const naviRoot = routingConfig.navi_root || path.resolve(__dirname, '..', '..', 'NAVI');

  const storageRel = rp[route] || null;
  const storage = storageRel ? path.normalize(path.join(naviRoot, storageRel)) : null;

  // map function (after dot) to office name
  const parts = (route || '').split('.');
  let func = parts[1] || null;
  let officeName = null;

  // If route is a single-agent token (e.g., 'EXEC'), treat that as the office directly
  if (!func && route && fp[route]) {
    officeName = fp[route] || route;
  } else {
    officeName = func && fp[func] ? fp[func] : null;
  }
  const officeInbox = officeName ? path.normalize(path.join(naviRoot, 'offices', officeName, 'inbox')) : null;

  return { route, storage, storageRel, officeName, officeInbox };
}

module.exports = {
  decideRoute,
  matchEntity,
  guessDocType,
  detectFunction,
  getPathsForRoute
};