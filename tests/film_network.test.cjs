'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const f=require('../site/film-network.js');
const csv='asset_id,verified_domain,project_name\nFILM-01,cinema.example.com,First Story\nFILM-02,film.example.org,Second Story\n';
test('R13 imports only real candidate domains, never invents assets',()=>{
 const list=f.importCsv(csv);
 assert.equal(list.length,2);
 assert.equal(list[0].slot,'FILM-01');
 assert.equal(list[0].domain,'cinema.example.com');
 assert.equal(list[0].checks.domain_control,false);
 assert.equal(list[0].checks.content_rights,false);
 assert.equal(f.shortlist(list).length,0);
 const rows=f.importCsv('asset_id,verified_domain,project_name\nFILM-01,,\nFILM-02,,\n');
 assert.deepEqual(rows,[]);
});
test('R13 rejects invalid slot identifiers, duplicates and unsafe URLs',()=>{
 for(const body of [
  'asset_id,verified_domain\nFILM-44,example.com',
  'asset_id,verified_domain\nFILM-00,example.com',
  'asset_id,verified_domain\nFILM-01,example.com\nFILM-01,another.com',
  'asset_id,verified_domain\nFILM-01,https://127.0.0.1/',
  'asset_id,verified_domain\nFILM-01,https://example.com/?token=hidden'
 ])assert.throws(()=>f.importCsv(body));
 assert.throws(()=>f.importCsv('verified_domain\n'+Array.from({length:44},(_,i)=>'film'+i+'.example.org').join('\n')));
});
test('R13 ranks at most three based on author self-checks, never claims ownership proof',()=>{
 const list=f.importCsv('asset_id,verified_domain,project_name\n'+Array.from({length:5},(_,i)=>'FILM-0'+(i+1)+',film'+i+'.example.org,Story '+i).join('\n'));
 for(const site of list)for(const key of f.REQUIRED)site.checks[key]=true;
 list[4].checks.source_access=true;list[4].checks.performance_checked=true;
 const choices=f.shortlist(list);assert.equal(choices.length,3);
 assert.equal(choices[0].slot,'FILM-05');
 assert.equal(choices[0].review_status,'candidate_pending_independent_verification');
 const packet=f.report(list,'2026-10-24T01:00:00.000Z');
 assert.equal(packet.externally_verified,false);
 assert.equal(packet.publication_state,'not_published');
 assert.equal(packet.analytics_events_collected,0);
 assert.equal(packet.sites.length,5);
 assert.equal(packet.sites[0].independent_rights_verification,false);
 assert.equal(packet.shortlist.length,3);
});
test('R13 strict export schema blocks forged approvals and injection',()=>{
 const [site]=f.importCsv(csv);site.name='<img src=x onerror=alert(1)>';
 const packet=f.report([site],'2026-10-24T01:00:00.000Z');
 assert.equal(packet.sites[0].name,site.name);
 site.checks.domain_control=true;site.checks.content_rights=true;
 assert.throws(()=>f.referral(site),/AUTHOR_ATTESTATION_REQUIRED/);
 site.checks.after_ending_cta=true;
 const html=f.referral(site);
 assert.ok(html.includes('&lt;img src=x'));
 assert.ok(!html.includes('<img src=x'));
 assert.ok(html.includes('rel="noopener noreferrer"'));
 assert.ok(!html.includes('onerror='));
 assert.throws(()=>f.report([{...site,admin:true}],'2026-10-24T01:00:00.000Z'),/UNKNOWN_SITE_FIELD/);
 const broken={...site,checks:{...site.checks,role:'owner'}};
 assert.throws(()=>f.report([broken],'2026-10-24T01:00:00.000Z'),/INVALID_SITE_CHECKS/);
 assert.throws(()=>f.report([site,site],'2026-10-24T01:00:00.000Z'),/DUPLICATE_FILM_OR_DOMAIN/);
});
test('R13 public UI includes accessible controls and no network-tracking code',()=>{
 const root=path.join(__dirname,'../site');
 const html=fs.readFileSync(path.join(root,'film-network.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'film-network.css'),'utf8');
 const js=fs.readFileSync(path.join(root,'film-network.js'),'utf8');
 for(const id of ['fn-app','fn-template','fn-import','fn-clear','fn-status','fn-sites','fn-count','fn-checks','fn-note','fn-pilot','fn-download','fn-snippet'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('aria-live="polite"'));
 assert.ok(html.includes('src="./network.js"'));
 assert.match(css,/@media\(max-width:490px\)/);
 assert.match(css,/:focus-visible/);
 for(const word of ['fetch(', 'XMLHttpRequest','sendBeacon','localStorage','sessionStorage','document.cookie','innerHTML','new WebSocket('])
   assert.ok(!js.includes(word),'forbidden API '+word);
});
