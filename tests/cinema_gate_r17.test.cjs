'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RECORDS,inspect,sha1}=require('../tools/cinema_release_gate_r17.cjs');
const ROOT=path.resolve(__dirname,'..');
test('R17 pins three distinct authentic cinema sources',()=>{
 assert.equal(RECORDS.length,3);
 assert.equal(new Set(RECORDS.map(x=>x.source)).size,3);
 for(const r of RECORDS){assert.match(r.commit,/^[a-f0-9]{40}$/);assert.match(r.relative,/^site\/film-[a-z-]+\.html$/);}
});
test('R17 real preview has its exact Git object; unpublished engines stay source-only',()=>{
 const status=inspect();
 assert.equal(status[0].status,'candidate');
 for(const item of status.slice(1))assert.ok(['candidate','source_only'].includes(item.status));
 assert.ok(status.every(x=>!x.gate),'Automated approval is intentionally impossible without manual/browser review');
 assert.equal(sha1(fs.readFileSync(path.join(ROOT,RECORDS[0].relative))),RECORDS[0].blob);
});
test('R17 refuses to promote an incomplete standalone to playable',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-cinema-gate-'));
 try{
  fs.mkdirSync(path.join(root,'site'));
  fs.writeFileSync(path.join(root,'site/film-protocol-zero.html'),'<html>PROTOCOL ZERO</html>');
  const rows=inspect(root);
  assert.equal(rows[1].status,'rejected');
  assert.equal(rows[1].reason,'SIZE_OUTSIDE_REVIEW');
  assert.equal(rows[2].status,'source_only');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('R17 cinema hub names real original source engines, not invented live URLs',()=>{
 const html=fs.readFileSync(path.join(ROOT,'site/cinema-pilot.html'),'utf8');
 assert.match(html,/id="cinema-r17"/);
 for(const r of RECORDS.slice(1))assert.ok(html.includes(r.commit),'Pinned source commit '+r.slug);
 assert.match(html,/Правило выпуска R17/);
 assert.equal((html.match(/href="\.\/film-(?:protocol-zero|adverse-judge)\.html"/g)||[]).length,0);
});
