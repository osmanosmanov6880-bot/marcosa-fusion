'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const atlas=require('../site/source-hub.js');
const root=path.resolve(__dirname,'..');
const repos=JSON.parse(fs.readFileSync(path.join(root,'inventory/verified_github_repositories_r15.json'),'utf8'));
const archives=JSON.parse(fs.readFileSync(path.join(root,'inventory/verified_source_archives_r15.json'),'utf8'));

test('R15 source map is grounded in 20 accessible repositories and 13 supplied ZIPs',()=>{
 const all=atlas.RECORDS;
 assert.equal(repos.count,20);assert.equal(repos.repos.length,20);
 assert.equal(archives.unique_archive_count,13);assert.equal(archives.packages.length,13);
 assert.equal(all.length,33);
 assert.equal(all.filter(x=>x.kind==='github').length,20);
 assert.equal(all.filter(x=>x.kind==='archive').length,13);
 const seen=new Set();
 for(const item of all){
  assert.ok(!seen.has(item.kind+'|'+item.name),'Duplicate source entry');
  seen.add(item.kind+'|'+item.name);
  assert.equal(item.production_verified,false,'No invented deployed domain');
  if(item.kind==='github'){
   assert.equal(atlas.safeExternal(item.source_url),item.source_url);
   assert.ok(repos.repos.some(x=>x.github_url===item.source_url),'Repository must be in connected GitHub inventory');
  }else{
   const match=archives.packages.find(x=>x.archive===item.archive);
   assert.ok(match,'ZIP must be recorded as user-provided');
   assert.equal(item.sha256,match.zip_sha256);
   assert.equal(item.files,match.files);
   assert.match(item.sha256,/^[0-9a-f]{64}$/);
  }
 }
});
test('R15 cinema classification distinguishes real source from deployed film domains',()=>{
 const all=atlas.RECORDS;
 const films=atlas.filter(all,'','cinema');
 assert.ok(films.some(x=>x.name==='internet-v-humanity'));
 assert.ok(films.some(x=>x.name==='protocol-zero'));
 assert.ok(films.some(x=>x.name==='adverse-judge'));
 assert.ok(films.some(x=>x.kind==='archive'&&x.archive.includes('SIGNAL_WORLDS')));
 assert.ok(films.some(x=>x.kind==='archive'&&x.archive.includes('OpsPilot')));
 const preview=films.find(x=>x.name==='internet-v-humanity');
 assert.equal(preview.is_full_cinema,false,'GitHub is a standalone preview, not full release');
 assert.ok(films.every(x=>x.production_verified===false));
});
test('R15 search filters and GitHub outbound links are safe',()=>{
 const all=atlas.RECORDS;
 assert.equal(atlas.filter(all,'','github').length,20);
 assert.equal(atlas.filter(all,'','archives').length,13);
 assert.equal(atlas.filter(all,'ПрОтОкОл').length,0);
 assert.equal(atlas.filter(all,'protocol-zero')[0].name,'protocol-zero');
 assert.throws(()=>atlas.filter(all,'','admin'),/INVALID_SOURCE_FILTER/);
 assert.throws(()=>atlas.safeExternal('javascript:alert(1)'),/UNVERIFIED_SOURCE_URL/);
 assert.throws(()=>atlas.safeExternal('https://github.com/attacker/evil'),/UNVERIFIED_SOURCE_URL/);
 assert.throws(()=>atlas.safeExternal('https://github.com/osmanosmanov6880-bot/x?user=1'),/UNVERIFIED_SOURCE_URL/);
});
test('R15 UI is accessible, source data-only, no secret keys or fake analytics',()=>{
 const html=fs.readFileSync(path.join(root,'site/source-hub.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'site/source-hub.css'),'utf8');
 const js=fs.readFileSync(path.join(root,'site/source-hub.js'),'utf8');
 for(const id of ['sh-app','sh-grid','sh-search','sh-count','sh-total-repos','sh-total-archives'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('aria-live="polite"'));
 assert.ok(html.includes('data-sh-filter="cinema"'));
 assert.ok(html.includes('43 кино-доменов'));
 assert.ok(js.includes('doc.createElement'));
 assert.ok(js.includes('node.textContent'));
 assert.match(css,/:focus-visible/);
 assert.match(css,/@media\(max-width:650px\)/);
 for(const blocked of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket(',
  'sessionStorage','localStorage','document.cookie','innerHTML','service_role','new Image('])
  assert.ok(!js.includes(blocked),'Forbidden client operation '+blocked);
});
