'use strict';
// R19: evidence from three reviewed user-supplied R15 cinematic archives.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const manifest=JSON.parse(read('inventory/playable_cinema_r19.json'));
test('R19 source provenance permits precisely three unrelated original cinematic engines',()=>{
 assert.equal(manifest.schema,'marcosa-playable-source-snapshot/v2');
 assert.equal(manifest.release,'R19');
 assert.equal(manifest.films.length,3);
 assert.equal(new Set(manifest.films.map(x=>x.file)).size,3);
 assert.ok(manifest.films.every(x=>x.source_archive_sha256?.length===64));
 assert.equal(manifest.privacy.server_user_data_transfers,false);
 assert.equal(manifest.privacy.autoplay,false);
 assert.equal(manifest.server_production_unchanged,true);
});
test('R19 54 original WebP and cinema JS remain embedded in byte-exact distributed sources',()=>{
 let total=0;
 for(const record of manifest.films){
  assert.match(record.file,/^site\/film-(?:signal-worlds|opspilot|intentgraph)\.html$/);
  const bytes=fs.readFileSync(path.join(ROOT,record.file));
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual,record.sha256,'changed original reviewed cinema bytes: '+record.file);
  assert.equal(bytes.length,record.bytes);
  assert.ok(bytes.length>500000&&bytes.length<4000000);
  const source=bytes.toString('utf8');
  assert.ok(source.startsWith('<!doctype html>'));
  assert.ok((source.match(/data:image\/webp;base64,/g)||[]).length>=record.embedded_webp,record.file);
  assert.doesNotMatch(source,/<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(source,/<link\b[^>]*\brel\s*=\s*["']stylesheet/i);
  assert.doesNotMatch(source,/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{30,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/);
  assert.ok(source.includes('https://marcosa.club/'),'Original voluntary ending is missing');
  const scripts=[...source.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
  assert.ok(scripts.length>=1,'Engine was not bundled');
  for(const [index,code] of scripts.entries())assert.doesNotThrow(()=>new vm.Script(code,{filename:record.file+':'+index}));
  total+=record.embedded_webp;
 }
 assert.equal(total,54);
});
test('R19 original endings are preserved and hosting probes are disabled in static OpsPilot',()=>{
 const s=read('site/film-signal-worlds.html');
 const o=read('site/film-opspilot.html');
 const i=read('site/film-intentgraph.html');
 assert.ok(s.includes('offlineSceneData')&&s.includes('offlineAssetData'));
 assert.ok(s.includes("scene.ui==='end'||scene.ui==='protoend'"));
 assert.ok(o.includes("spec.endings.includes(id)"));
 assert.ok(o.includes('data-marcosa-static-film="1"'));
 assert.ok(o.includes("document.documentElement.dataset.marcosaStaticFilm==='1'"));
 assert.ok(i.includes("state.current==='finale'"));
 assert.ok(i.includes('window.CINEMA_EMBEDDED_PLATES'));
});
test('R19 all six film destinations are visible in the real player and archive source atlas',()=>{
 const h=read('site/cinema-pilot.html'),js=read('site/cinema-pilot.js'),atlas=read('site/source-hub.js');
 for(const film of ['signal-worlds','opspilot','intentgraph']){
  assert.ok(h.includes('data-cp-film="'+film+'"'),film);
  assert.ok(js.includes("'"+film+"':Object.freeze({"),film);
  assert.ok(h.includes('href="./film-'+film+'.html"'),film);
  assert.ok(js.includes("src:'./film-"+film+".html'"),film);
 }
 assert.ok(atlas.includes('R19_PLAYABLE'));
 assert.ok(atlas.includes("'./cinema-pilot.html#'+slug"));
 assert.ok(h.includes('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"'));
 assert.ok(!h.includes('allow-same-origin'));
 assert.ok(!h.includes('allow-top-navigation'));
 assert.equal((js.match(/src:'\.\/film-[a-z-]+\.html'/g)||[]).length,6);
 assert.ok(!js.includes('fetch('));
 assert.ok(!js.includes('localStorage'));
});
