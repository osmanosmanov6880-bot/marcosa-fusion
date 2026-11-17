import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const at = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const doc = JSON.parse(at('site/ecosystem-manifest.json'));
const page = at('site/ecosystem.html');
const script = at('site/ecosystem.js');
const build = at('tools/build_webroot.py');
const home = at('site/index.html');
const repoOwner = 'https://github.com/osmanosmanov6880-bot/';

test('R141 counts only independently observed public GitHub source repositories', () => {
  assert.equal(doc.schema, 'marcosa-ecosystem-public-sources/v1');
  assert.equal(doc.repositoryCount, 23);
  assert.equal(doc.entries.length, 23);
  assert.equal(new Set(doc.entries.map(x => x.repository)).size, 23);
  assert.ok(doc.entries.some(x => x.repository === 'marcosa-fusion'));
  assert.ok(doc.entries.some(x => x.repository === 'osmanx-world'));
  assert.ok(doc.entries.some(x => x.repository === 'osmanx-retail-intelligence'));
  for (const entry of doc.entries) {
    assert.match(entry.repository, /^[A-Za-z0-9._-]{1,90}$/);
    assert.equal(entry.sourceUrl, repoOwner + entry.repository);
    assert.ok(['platform', 'business', 'worlds', 'cinema', 'research'].includes(entry.category));
    assert.ok(['source', 'docs', 'stub'].includes(entry.sourceStatus));
    assert.equal(entry.productionVerified, false);
    assert.equal(entry.marcosaRuntimeIntegrated, false);
  }
});

test('R141 explicitly refuses all false production claims and sensitive source publication', () => {
  assert.equal(doc.productionAuthorized, false);
  assert.equal(doc.legacyReplacementAuthorized, false);
  assert.equal(doc.integratedProductionAppsVerified, 0);
  assert.equal(doc.scope, 'public_source_directory_only');
  assert.doesNotMatch(JSON.stringify(doc), /secret|private[_ -]key|service[_-]role|access[_-]token|password/i);
  assert.match(page, /production-no-go/);
  assert.match(page, /Supabase/);
  assert.match(page, /legacy/i);
  assert.doesNotMatch(script, /innerHTML|eval\(|localStorage|document\.cookie|sendBeacon|XMLHttpRequest/);
  assert.match(script, /credentials: 'omit'/);
  assert.match(script, /sourceUrl !== 'https:\/\/github\.com\/osmanosmanov6880-bot\//);
  assert.match(script, /productionVerified !== false/);
});

test('R141 connects real MARCOSA preview routes, not fictitious app endpoints', () => {
  for (const path of ['social.html', 'cinema-pilot.html', 'creator.html', 'film-network.html']) {
    assert.ok(page.includes('href="./' + path + '"'));
  }
  assert.ok(page.includes('src="./ecosystem.js"'));
  assert.ok(page.includes('href="./ecosystem.css"'));
  assert.ok(home.includes('href="./ecosystem.html"'));
  for (const file of ['ecosystem.html', 'ecosystem.css', 'ecosystem.js', 'ecosystem-manifest.json']) {
    assert.ok(build.includes('"' + file + '"'), 'Missing static allowlist file ' + file);
  }
});
