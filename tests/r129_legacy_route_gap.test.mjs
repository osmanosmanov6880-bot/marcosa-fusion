import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditPreview,classifyReference,CRITICAL,HISTORY}
  from '../ops/r129_legacy_route_gap.mjs';

const SHA='a'.repeat(40);
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r129-'));
 writeFileSync(join(dir,'index.html'),
  '<a href="./creator.html">Creator</a><script src="./app.js"></script>'+
  '<link href="./theme.css" rel="stylesheet">'+
  '<form action="https://tokens.example.invalid/sso?token=DO-NOT-ECHO"></form>'+
  '<a href="javascript:alert(1)">unsafe</a>'+
  '<img src="data:image/png;base64,SECRET-DO-NOT-LEAK">');
 writeFileSync(join(dir,'creator.html'),'<a href="./missing.js">Missing</a>');
 writeFileSync(join(dir,'app.js'),'// Content SECRET-DO-NOT-LEAK');
 writeFileSync(join(dir,'theme.css'),'body{}');
 return dir;
}
const cleanup=dir=>rmSync(dir,{recursive:true,force:true});
test('R129 inventories real test-source routes and NEVER claims production GO',()=>{
 const dir=fixture();
 try{
   const r=auditPreview({siteDir:dir,sourceSha:SHA});
   assert.equal(r.format,'MARCOSA-R129-LEGACY-PREVIEW-ROUTE-GAP-v1');
   assert.equal(r.sourceFileCount,4);
   assert.equal(r.htmlRouteCount,2);
   assert.deepEqual(r.routes.map(x=>x.name),['creator.html','index.html']);
   assert.deepEqual(r.routes[1].linkedHtmlRoutes,['creator.html']);
   assert.deepEqual(r.missingSourceAssetCandidates,['missing.js']);
   assert.deepEqual(r.missingLegacyModuleFilenamesInPreview,[...CRITICAL]);
   assert.equal(r.externalHtmlReferenceCount,1);
   assert.equal(r.potentiallyUnsafeSchemeCount,1);
   assert.equal(r.legacyProductionRuntimeReviewed,false);
   assert.equal(r.authSessionAndCookieParityProven,false);
   assert.equal(r.productionCutoverAuthorized,false);
   assert.equal(r.productionDecision,'NO_GO');
   assert.doesNotMatch(JSON.stringify(r),/DO-NOT-ECHO|SECRET-DO-NOT-LEAK|tokens\.example/);
 }finally{cleanup(dir)}
});
test('even all five module filenames cannot certify Auth or user compatibility',()=>{
 const dir=fixture();
 try{
   for(const name of CRITICAL)writeFileSync(join(dir,name),'// fake unreviewed file');
   const r=auditPreview({siteDir:dir,sourceSha:SHA});
   assert.equal(r.missingLegacyModuleFilenamesInPreview.length,0);
   assert.equal(r.ownerApprovedMigrationMapping,false);
   assert.equal(r.productionDecision,'NO_GO');
 }finally{cleanup(dir)}
});
test('historic 2026 R118 is NOT current VPS proof',()=>{
 const dir=fixture();
 try{
   const r=auditPreview({siteDir:dir,sourceSha:SHA});
   assert.equal(r.historicalBaseline.currentProductionProven,false);
   assert.equal(r.historicalBaseline.r118RunId,HISTORY.r118RunId);
   assert.notEqual(r.historicalBaseline.auditSha,r.sourceSha);
 }finally{cleanup(dir)}
});
test('incorrect or missing SHA/source rejected',()=>{
 const dir=fixture();
 try{
   assert.throws(()=>auditPreview({siteDir:dir,sourceSha:'incomplete'}),/source SHA/);
   assert.throws(()=>auditPreview({siteDir:'',sourceSha:SHA}),/directory/);
 }finally{cleanup(dir)}
});
test('symlink file is rejected even if it points to public code',()=>{
 const dir=fixture();
 try{
   symlinkSync(join(dir,'app.js'),join(dir,'copy.js'));
   assert.throws(()=>auditPreview({siteDir:dir,sourceSha:SHA}),/Symlink/);
 }finally{cleanup(dir)}
});
test('secret-looking config file in public source blocks audit',()=>{
 const dir=fixture();
 try{
   writeFileSync(join(dir,'credentials.json'),'{"secret":"DO-NOT-ECHO"}');
   assert.throws(()=>auditPreview({siteDir:dir,sourceSha:SHA}),/sensitive/);
 }finally{cleanup(dir)}
});
test('new nested directory is not silently considered audited public source',()=>{
 const dir=fixture();
 try{
   mkdirSync(join(dir,'nested'));
   assert.throws(()=>auditPreview({siteDir:dir,sourceSha:SHA}),/sensitive|Symlink/);
 }finally{cleanup(dir)}
});
test('classifier strips tokens and refuses traversal/external/private paths',()=>{
 assert.deepEqual(classifyReference('./creator.html?session=PRIVATE#frag'),
   {kind:'local',name:'creator.html'});
 assert.deepEqual(classifyReference('https://example.com/secret?key=x'),
   {kind:'external'});
 assert.deepEqual(classifyReference('./../../private.js'),{kind:'nested'});
 assert.deepEqual(classifyReference('./nested/private.js'),{kind:'nested'});
 assert.deepEqual(classifyReference('./%2e%2e/secret.js'),{kind:'nested'});
 assert.deepEqual(classifyReference('javascript:alert(1)'),{kind:'danger'});
 assert.deepEqual(classifyReference('data:image/png;base64,sensitive'),{kind:'ignored'});
 assert.deepEqual(classifyReference('/plain.js'),{kind:'local',name:'plain.js'});
});
test('repeat audit is deterministic and no real production state is mutated',()=>{
 const dir=fixture();
 try{
   const a=auditPreview({siteDir:dir,sourceSha:SHA});
   const b=auditPreview({siteDir:dir,sourceSha:SHA});
   assert.deepEqual(a,b);
   assert.equal(a.existingProductionFilesModified,false);
   assert.equal(a.realPostgresAuthAndPrivateStorageRestoreProven,false);
 }finally{cleanup(dir)}
});
