import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const registry = JSON.parse(read('inventory/cinema_preview_registry_r142.json'));
const player = read('site/cinema-pilot.js');
const csv = read('inventory/film-sites.csv');

test('R142 cinema preview registry contains exactly the six selectable source-backed works', () => {
  const expected = ['internet-v-humanity','protocol-zero','adverse-judge','signal-worlds','opspilot','intentgraph'];
  assert.equal(registry.schema, 'marcosa-cinema-preview-registry/v1');
  assert.equal(registry.records.length, 6);
  assert.deepEqual(registry.records.map(x => x.slug), expected);
  for (const item of registry.records) {
    assert.ok(item.title);
    assert.match(item.preview_route, /^\/film-[a-z0-9-]+\.html$/);
    assert.ok(item.source_reference);
    assert.ok(item.evidence);
    assert.ok(player.includes('data-cp-film="' + item.slug + '"'), 'missing cinema selector: ' + item.slug);
    assert.ok(player.includes("'./film-" + item.slug + ".html'"), 'missing preview route in player: ' + item.slug);
    assert.equal(item.external_domain, null, 'do not infer a project domain from source code');
    assert.equal(item.rights_status, 'pending');
    assert.equal(item.production_verified, false);
  }
});

test('R142 keeps the 43 unverified site slots separate from preview films', () => {
  assert.equal(registry.external_domains_verified, 0);
  assert.deepEqual(registry.unverified_external_site_slots, {
    file: 'inventory/film-sites.csv',
    count: 43,
    status: 'unverified_missing_domain',
    included_as_launch_targets: false
  });
  const rows = csv.trim().split(/\r?\n/);
  assert.equal(rows.length, 44);
  assert.ok(rows.slice(1).every(row => /unverified_missing_domain/.test(row)));
  assert.ok(rows.slice(1).every(row => /^FILM-\d{2},,,,,,,unverified_missing_domain,$/.test(row)));
});
