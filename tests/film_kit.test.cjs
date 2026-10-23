'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mod = require('../site/network.js');

test('catalogue has 16 uniquely identified, unlaunched source products', () => {
  assert.equal(mod.products.length, 16);
  assert.equal(mod.film_slots, 43);
  assert.equal(new Set(mod.products.map(p => p.id)).size, 16);
  assert.equal(new Set(mod.products.map(p => p.slug)).size, 16);
  assert.ok(mod.products.every(p => p.live === false));
});

test('domain validator accepts HTTPS domain and rejects local or unsafe paths', () => {
  assert.equal(mod.checkDomain('https://Cinema.Example.com/'), 'cinema.example.com');
  assert.equal(mod.checkDomain('Cinema.Example.com'), 'cinema.example.com');
  for (const value of [
    'http://example.com', 'https://localhost', 'https://127.0.0.1',
    'https://10.0.0.2', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://admin:pass@example.com/', 'https://example.com/?token=x',
    'https://example.com/#home', 'https://example.com/private',
    'https://example.com:1234', 'https://bad test.com'
  ]) {
    assert.throws(() => mod.checkDomain(value), undefined, value);
  }
});

test('CSV import preserves quoted fields and marks all domains unverified', () => {
  const csv = [
    'asset_id,verified_domain,project_name',
    'FILM-01,https://film.example.com/,"Film, Part 1"',
    'FILM-02,another.example.org,Second film'
  ].join('\r\n') + '\r\n';
  const rows = mod.parseFilmImport(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].domain, 'film.example.com');
  assert.equal(rows[0].project_name, 'Film, Part 1');
  assert.equal(rows[0].verified, false);
  assert.equal(rows[0].rights_verified, false);
  assert.equal(rows[1].domain, 'another.example.org');
});

test('CSV rejects duplicate domains or missing required headers', () => {
  assert.throws(() => mod.parseFilmImport('asset_id,verified_domain\nFILM-01,example.com\nFILM-02,https://example.com/'), /DUPLICATE_DOMAIN/);
  assert.throws(() => mod.parseFilmImport('domain\nexample.com'), /MISSING_COLUMN/);
  assert.throws(() => mod.parseFilmImport('asset_id,verified_domain\nFILM-01,"unfinished'), /CSV_UNTERMINATED_QUOTE/);
});

test('CSV rejects excessive entries and oversized input', () => {
  const many = 'verified_domain\n' + Array.from({length:44}, (_,i)=>'sample'+i+'.example.org').join('\n');
  assert.throws(() => mod.parseFilmImport(many), /TOO_MANY_FILMS|CSV_TOO_MANY_ROWS/);
  assert.throws(() => mod.parseFilmImport('x'.repeat(262145)), /CSV_SIZE/);
});

test('exported HTML escapes film messages, does not inject scripts or trackers', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const output = mod.movieSnippet({message:bad,product_name:'A & B'});
  assert.ok(output.includes('&lt;img'));
  assert.ok(!output.includes('<img'));
  assert.ok(output.includes('A &amp; B'));
  assert.ok(output.includes('rel="noopener noreferrer"'));
  assert.ok(!/https?:\/\/(?:google-analytics|facebook)/.test(output));
});
