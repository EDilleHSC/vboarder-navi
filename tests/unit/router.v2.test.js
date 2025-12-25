const fs = require('fs');
const os = require('os');
const path = require('path');
const { decideRoute } = require('../../runtime/current/lib/router');
const { writeSidecar } = require('../../runtime/current/lib/sidecar');

describe('router v2 behavior', () => {
  test('Finance high confidence routes to CFO', () => {
    const routingConfig = { confidence: { auto_route_threshold: 90 }, intent_definitions: { Finance: { office: 'CFO', keywords: ['invoice'] } } };
    const item = { filename: 'bill.pdf', extractedText: 'invoice payment due', detectedEntities: [{ entity: 'DDM', confidence: 0.92 }] };
    const res = decideRoute(item, routingConfig);
    expect(res.route).toBe('CFO');
    expect(res.autoRoute).toBe(true);
  });

  test('Receipt 55% routes to EXEC (threshold 60)', () => {
    const routingConfig = { confidence: { auto_route_threshold: 60 }, intent_definitions: { Finance: { office: 'CFO', keywords: ['receipt'] } } };
    const item = { filename: 'Receipt_0401.pdf', extractedText: 'this is a receipt for service', detectedEntities: [{ entity: 'DDM', confidence: 0.55 }] };
    const res = decideRoute(item, routingConfig);
    expect(res.route).toBe('EXEC');
    expect(res.autoRoute).toBe(false);
  });

  test('Unknown intent routes to EXEC', () => {
    const routingConfig = { confidence: { auto_route_threshold: 50 }, intent_definitions: {} };
    const item = { filename: 'mystery.bin', extractedText: 'contract number 1234', detectedEntities: [] };
    const res = decideRoute(item, routingConfig);
    expect(res.route).toBe('EXEC');
    expect(res.autoRoute).toBe(false);
  });

  test('Insurance filename heuristic forces CFO when text missing/low-conf', () => {
    const routingConfig = { confidence: { auto_route_threshold: 60 }, intent_definitions: {} };
    const item = { filename: 'Progressive_Insurance_Statement.pdf', extractedText: '', detectedEntities: [] };
    const res = decideRoute(item, routingConfig);
    expect(res.route).toBe('CFO');
    expect(res.autoRoute).toBe(true);
    expect(res.reasons).toContain('heuristic_filename_insurance');
  });

  test('Sidecar preserves extracted_text_snippet and detectedEntities', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-test-'));
    const f = path.join(tmp, 'test.pdf');
    fs.writeFileSync(f, 'dummy content');
    const scOut = { filename: 'test.pdf', extracted_text_snippet: 'sample text', detectedEntities: [{ entity: 'LHI', confidence: 0.8 }], function: 'Finance', route: 'CFO' };
    const scPath = writeSidecar(f, scOut);
    const sc = JSON.parse(fs.readFileSync(scPath, 'utf8'));
    expect(sc.extracted_text_snippet).toBe('sample text');
    expect(Array.isArray(sc.detectedEntities)).toBe(true);
    expect(sc.detectedEntities[0].entity).toBe('LHI');
  });

  test('Entity is metadata-only and does not drive routing without intent', () => {
    const routingConfig = { confidence: { auto_route_threshold: 90 }, intent_definitions: {} };
    const item = { filename: 'unknown.pdf', extractedText: '', detectedEntities: [{ entity: 'LTD', confidence: 0.95 }] };
    const res = decideRoute(item, routingConfig);
    expect(res.route).toBe('EXEC');
    expect(res.entity).toBe('LTD');
  });
});