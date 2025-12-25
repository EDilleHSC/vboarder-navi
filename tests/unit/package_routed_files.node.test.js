const fs = require('fs');
const path = require('path');
const { packageRoutedFiles } = require('../../scripts/package_routed_files');

const TEST_ROOT = path.join(__dirname, 'temp_node_pkg_test');

beforeAll(() => {
  if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

test('node packager handles object/string/array sidecars', () => {
  const route = path.join(TEST_ROOT, 'route');
  fs.mkdirSync(route);

  // 1) normal object
  fs.writeFileSync(path.join(route, 'doc1.pdf'), 'PDF');
  fs.writeFileSync(path.join(route, 'doc1.pdf.navi.json'), JSON.stringify({ route: 'x', extracted_text_snippet: 'hi' }));

  // 2) primitive (string)
  fs.writeFileSync(path.join(route, 'doc2.pdf'), 'PDF');
  fs.writeFileSync(path.join(route, 'doc2.pdf.navi.json'), 'just a string');

  // 3) array
  fs.writeFileSync(path.join(route, 'doc3.pdf'), 'PDF');
  fs.writeFileSync(path.join(route, 'doc3.pdf.navi.json'), JSON.stringify(['a','b','c']));

  const packagesRoot = path.join(TEST_ROOT, 'packages');
  const res = packageRoutedFiles({ routeFolder: route, packagesRoot, limit: 0 });
  const pkgDir = res.pkgDir;

  // basic assertions
  const manifest = fs.readFileSync(path.join(pkgDir, 'manifest.csv'), 'utf8');
  expect(manifest).toContain('doc1.pdf');

  // doc1 should have packaged true in its navi.json (both original and package copy)
  const n1pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'doc1.pdf.navi.json'), 'utf8'));
  expect(n1pkg.packaged).toBe(true);

  const n1orig = JSON.parse(fs.readFileSync(path.join(route, 'doc1.pdf.navi.json'), 'utf8'));
  expect(n1orig.packaged).toBe(true);

  // doc2 and doc3 package copies should have wrapper with packaged=true
  const n2pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'doc2.pdf.navi.json'), 'utf8'));
  expect(n2pkg.packaged).toBe(true);
  const n3pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'doc3.pdf.navi.json'), 'utf8'));
  expect(n3pkg.packaged).toBe(true);
});

test('package naming includes explicit department when provided', () => {
  const route = path.join(TEST_ROOT, 'route2');
  fs.mkdirSync(route);
  fs.writeFileSync(path.join(route, 'a.txt'), 'A');
  const packagesRoot = path.join(TEST_ROOT, 'packages2');
  const res = packageRoutedFiles({ routeFolder: route, packagesRoot, limit: 0, department: 'Finance' });
  const pkgDir = res.pkgDir;
  const base = path.basename(pkgDir);
  expect(base.startsWith('FINANCE_')).toBe(true);
});
