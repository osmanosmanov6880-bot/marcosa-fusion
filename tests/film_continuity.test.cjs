'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const kit=require('../site/film-network.js');
const continuity=require('../site/film-continuity.js');
const DATE='2026-10-24T03:45:00.000Z';
const source='asset_id,verified_domain,project_name\nFILM-01,movie.example.org,Story Alpha\nFILM-02,film.example.net,Story Beta\n';
function makeReport(){
 const sites=kit.importCsv(source);
 for(const key of kit.REQUIRED)sites[0].checks[key]=true;
 sites[0].note='Checked opening scene.\nNeeds an independent rights document.';
 return kit.report(sites,DATE);
}
const clone=x=>JSON.parse(JSON.stringify(x));
const serialize=x=>JSON.stringify(x);
test('R14 reopens authentic exported R13 review, preserving 43-site model and multiline notes',()=>{
 const report=makeReport();
 const imported=continuity.parseReport(serialize(report));
 assert.deepEqual(imported,report);
 assert.equal(imported.sites[0].note,'Checked opening scene.\nNeeds an independent rights document.');
 assert.equal(imported.shortlist.length,1);
 assert.equal(imported.externally_verified,false);
 assert.equal(imported.publication_state,'not_published');
 const restored=continuity.reportSites(imported);
 assert.deepEqual(restored,kit.importCsv(source).map((s,i)=>i? s :{...s,...{
  checks:{...s.checks,...Object.fromEntries(kit.REQUIRED.map(k=>[k,true]))},
  note:'Checked opening scene.\nNeeds an independent rights document.'
 }}));
 assert.equal(continuity.exportReport(restored,DATE).schema,kit.SCHEMA);
 assert.equal(continuity.MAX_BYTES,1024*1024);
 assert.equal(continuity.MAX_SNAPSHOTS,12);
});
test('R14 refuses forged approval/publication, inflated shortlist or changed check counters',()=>{
 const good=makeReport(),cases=[];
 for(const [field,value] of [
  ['externally_verified',true],['publication_state','published'],
  ['review_status','approved'],['analytics_events_collected',9999]
 ]){const bad=clone(good);bad[field]=value;cases.push(bad);}
 {const bad=clone(good);bad.sites[0].independent_rights_verification=true;cases.push(bad);}
 {const bad=clone(good);bad.sites[0].checks_completed=8;cases.push(bad);}
 {const bad=clone(good);bad.shortlist[0].rank=3;cases.push(bad);}
 {const bad=clone(good);bad.sites[0].missing_checks=[];cases.push(bad);}
 {const bad=clone(good);bad.sites[0].admin=true;cases.push(bad);}
 {const bad=clone(good);bad.sites[0].checks.owner_approved=true;cases.push(bad);}
 {const bad=clone(good);bad.internal_token='oops';cases.push(bad);}
 {const bad=clone(good);bad.generated_at='2026-10-24';cases.push(bad);}
 {const bad=clone(good);bad.sites.push(clone(bad.sites[0]));cases.push(bad);}
 for(const bad of cases)assert.throws(()=>continuity.parseReport(serialize(bad)),undefined,JSON.stringify(bad).slice(0,75));
});
test('R14 rejects malformed, oversized or unsafe JSON before touching current workspace',()=>{
 for(const value of [
  '{','[]','null','{"schema":"marcosa-film-pilot-evidence/v1"}',
  '{"__proto__":{"polluted":true},"schema":"marcosa-film-pilot-evidence/v1"}'
 ])assert.throws(()=>continuity.parseReport(value));
 assert.throws(()=>continuity.parseReport(' '.repeat(continuity.MAX_BYTES+1)),/REPORT_SIZE/);
 assert.throws(()=>continuity.parseReport(45),/REPORT_SIZE/);
 const report=makeReport();report.sites[0].domain='127.0.0.1';
 assert.throws(()=>continuity.parseReport(serialize(report)));
 const valid=makeReport();
 const record={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',saved_at:DATE,report:valid};
 assert.deepEqual(continuity.validateSnapshot(record),record);
 assert.throws(()=>continuity.validateSnapshot({...record,secret:'should-not-be-here'}),/INVALID_SNAPSHOT/);
 assert.throws(()=>continuity.validateSnapshot({...record,id:'../../private'}),/INVALID_SNAPSHOT_ID/);
 assert.throws(()=>continuity.validateSnapshot({...record,report:{...valid,publication_state:'published'}}),/FORGED_VERIFICATION/);
 assert.throws(()=>continuity.createStore(null,null),/LOCAL_STORAGE_UNAVAILABLE/);
});
test('R14 public UI is accessible, manual-only and keeps no hidden network transport',()=>{
 const root=path.resolve(__dirname,'../site');
 const js=fs.readFileSync(path.join(root,'film-continuity.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'film-network.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'film-network.css'),'utf8');
 const r13=fs.readFileSync(path.join(root,'film-network.js'),'utf8');
 for(const id of ['fn-continuity','fn14-heading','fn14-save','fn14-import','fn14-feedback','fn14-list'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('src="./film-continuity.js" defer'));
 assert.ok(html.includes('aria-live="polite"'));
 assert.ok(html.includes('accept=".json,application/json"'));
 assert.ok(js.includes('indexedDB.open'));
 assert.ok(js.includes("store.add(snapshot)"),'immutable snapshots');
 assert.ok(js.includes("store.count()"),'transaction-bound limit');
 assert.ok(js.includes('runtime.replaceSites'),'safe rehydrate after strict validation');
 assert.ok(r13.includes('replaceSites(records)'),'editor must expose verified state transition');
 assert.match(css,/\.fn-snapshot/);
 for(const language of ['ru','en','zh'])
  for(const key of ['save','import','warning','confirmLoad','confirmFile'])
   assert.ok(js.includes(key));
 for(const forbidden of [
  'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket(', 'document.cookie',
  'localStorage', 'sessionStorage', 'innerHTML', 'service_role', 'new Image('
 ])assert.ok(!js.includes(forbidden),'Unexpected unsafe network or storage method: '+forbidden);
});
