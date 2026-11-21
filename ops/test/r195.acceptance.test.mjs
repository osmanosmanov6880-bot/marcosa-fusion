import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import draft from '../r195/draft-core.cjs';
import {buildR194Fixture} from '../r194/fixture.mjs';
import {buildR195Handoffs} from '../r195/handoffs.mjs';
import {renderR195Dashboard} from '../r195/dashboard.mjs';
import {createR195SignedPackage,verifyR195SignedPackage} from '../r195/portable-package.mjs';
import {sealReceipt} from '../r190/common.mjs';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const now=Date.now();
const args={commit,bundleSha256,now},clock=()=>now;
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){return buildR194Fixture(args);}
function fromFixture(f){
 return {commit,bundleSha256,assessment:f.after.assessment,ledger:f.board,
  evidenceDelta:f.evidenceDelta,riskTrend:f.riskTrend};
}
test('R195 v2 local SHA-256 chain replays every task event, protects baseline and source',async()=>{
 const f=await fixture();
 const ref={sourceCommit:commit,assessmentSha256:f.after.assessment.evidenceSha256,
  initialProgress:f.board.progress};
 const a=await draft.create(ref);
 assert.equal(a.events.length,0);
 assert.equal(a.decision,'NO_GO');
 assert.equal(a.productionAuthorized,false);
 assert.equal(await draft.verify(a,ref),true);
 await assert.rejects(draft.append(a,ref,'TLS_ORIGIN','COMPLETE',now),/prohibited/);
 const b=await draft.append(a,ref,'TLS_ORIGIN','REOPEN',now);
 const c=await draft.append(b,ref,'TLS_ORIGIN','START',now+1);
 const d=await draft.append(c,ref,'TLS_ORIGIN','COMPLETE',now+2);
 assert.equal(d.progress.TLS_ORIGIN,'DONE_LOCAL');
 assert.equal(d.events.length,3);
 assert.equal(d.headSha256,d.events[2].eventSha256);
 const restored=await draft.importText(draft.exportText(d),ref);
 assert.equal(await draft.verify(restored,ref),true);
 assert.deepEqual(restored,d);
 for(const changed of [
  {...d,productionAuthorized:true},
  {...d,decision:'GO'},
  {...d,sourceCommit:'f'.repeat(40)},
  {...d,initialProgress:{...d.initialProgress,TLS_ORIGIN:'DONE_LOCAL'}},
  {...d,progress:{...d.progress,TLS_ORIGIN:'OPEN'}},
  {...d,headSha256:'c'.repeat(64)},
  {...d,events:[...d.events].reverse()},
  {...d,events:d.events.map((x,i)=>i===0?{...x,to:'DONE_LOCAL'}:x)},
  {...d,extraField:'injected'},
  {...d,schemaVersion:1}
 ])await assert.rejects(draft.verify(changed,ref),/R195 draft/);
 await assert.rejects(draft.importText('{"decision":"GO"}',ref),/R195 draft/);
 await assert.rejects(draft.importText('x'.repeat(70001),ref),/R195 draft/);
 await assert.rejects(draft.append(d,ref,'TLS_ORIGIN','REOPEN',now+1),
  /invalid event timestamp/);
});
test('R195 owner handoffs cover exactly eight controls and six independent roles',async()=>{
 const f=await fixture(),h=buildR195Handoffs(fromFixture(f));
 assert.equal(h.byOwner.length,6);
 assert.equal(h.totalControls,8);
 assert.equal(h.manifest.ownerHashes.length,6);
 assert.equal(h.manifest.decision,'NO_GO');
 assert.equal(h.productionAuthorized,false);
 assert.equal(sha(JSON.stringify(h.manifest)),h.manifestSha256);
 assert.equal(h.byOwner.reduce((sum,x)=>sum+x.count,0),8);
 for(const doc of h.byOwner){
  assert.ok(doc.markdown.includes('NO-GO'));
  assert.ok(doc.markdown.includes(commit));
  assert.ok(doc.csv.includes('"NO_GO"'));
  assert.ok(doc.csv.includes('"REQUIRED"'));
  assert.equal(sha(Buffer.from(doc.csv)),doc.csvSha256);
  assert.equal(sha(Buffer.from(doc.markdown)),doc.markdownSha256);
 }
 const faked={...f.board,progress:{...f.board.progress,TLS_ORIGIN:'DONE_LOCAL'}};
 assert.throws(()=>buildR195Handoffs({...fromFixture(f),ledger:faked}),/tampered/);
});
test('R195 dashboard displays 8 risk controls, 6 evidence transitions and actual role files',async()=>{
 const f=await fixture(),r=renderR195Dashboard(fromFixture(f));
 const html=r.html;
 assert.equal(r.productionAuthorized,false);
 assert.equal(r.handoffs.byOwner.length,6);
 assert.ok(html.includes('AUDIT DESK R195'));
 assert.ok(html.includes('id="r195-source" hidden'));
 assert.ok(html.includes('id="r195-history"'));
 assert.ok(html.includes('id="r195-file"'));
 assert.ok(html.includes('id="r195-owner"'));
 assert.ok(html.includes('id="r195-comparison"'));
 assert.ok(html.includes('id="r195-handoffs"'));
 assert.ok(html.includes('script-src &#39;sha256-'));
 assert.ok(html.includes('connect-src &#39;none&#39;'));
 assert.ok(html.includes('id="r194-search"'));
 assert.ok(html.includes('id="r194-filter"'));
 assert.equal((html.match(/class="control" id=/g)||[]).length,8);
 assert.equal((html.match(/data-r195-owner=/g)||[]).length,6);
 assert.ok(html.includes('УХУДШЕНИЕ'));
 assert.ok(html.includes('Изменены SHA-256 и статус'));
 assert.ok(!html.includes('src="https:'));
 assert.ok(!html.includes('onclick='));
 assert.ok(!html.includes('onerror='));
 assert.ok(html.includes('<strong>NO-GO</strong>'));
 assert.equal(r.decision,'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED');
 assert.equal(sha(Buffer.from(html)),r.htmlSha256);
 assert.equal(sha(Buffer.from(r.markdown)),r.markdownSha256);
 const t={...f.riskTrend,afterSha256:'c'.repeat(64)};
 assert.throws(()=>renderR195Dashboard({...fromFixture(f),riskTrend:t}),/tampered/);
});
test('R195 signed packet independently verifies Ed25519, git ancestry and report/handoff SHA pins',async()=>{
 const f=await fixture();
 const opts={commit,bundleSha256,beforeIntake:f.before.intake,
  afterIntake:f.after.intake,beforeAssessment:f.before.assessment,
  afterAssessment:f.after.assessment,ledger:f.board,
  evidenceDelta:f.evidenceDelta,riskTrend:f.riskTrend,
  privateKey:f.keyPair.privateKey,publicKeyDer:f.publicKeyDer,clock};
 const signed=createR195SignedPackage(opts);
 assert.equal(signed.productionAuthorized,false);
 const verifyArgs={
  bytes:signed.bytes,signature:signed.signature,publicKeyDer:f.publicKeyDer,
  expectedPublicKeySha256:signed.publicKeySha256,
  expectedFileSha256:signed.fileSha256,
  expectedDashboardSha256:signed.rendered.htmlSha256,
  expectedMarkdownSha256:signed.rendered.markdownSha256,
  expectedHandoffSha256:signed.rendered.handoffManifestSha256,
  commit,bundleSha256,clock
 };
 const result=verifyR195SignedPackage(verifyArgs);
 assert.equal(result.verified,true);
 assert.equal(result.handoffCount,6);
 assert.equal(result.productionAuthorized,false);
 const changed=Buffer.from(signed.bytes);changed[80]^=1;
 assert.throws(()=>verifyR195SignedPackage({...verifyArgs,bytes:changed}),/changed/);
 const signature=Buffer.from(signed.signature);signature[15]^=1;
 assert.throws(()=>verifyR195SignedPackage({...verifyArgs,signature}),/signature/);
 const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'});
 assert.throws(()=>verifyR195SignedPackage({...verifyArgs,publicKeyDer:other}),/key SHA pin/);
 assert.throws(()=>verifyR195SignedPackage({...verifyArgs,
  expectedHandoffSha256:'f'.repeat(64)}),/independent deterministic/);
 assert.throws(()=>verifyR195SignedPackage({...verifyArgs,
  clock:()=>now+3600001}),/too old/);
});
test('R195 offline CLI atomically creates real HTML, role CSV/MD and manifest files',async()=>{
 const f=await fixture();
 const tmp=mkdtempSync(join(tmpdir(),'marcosa-r195-'));
 const script=fileURLToPath(new URL('../r195/operator-cli.mjs',import.meta.url));
 try{
  const input={schemaVersion:1,sourceCommit:commit,
   sourceBundleSha256:bundleSha256,beforeAssessment:f.before.assessment,
   afterAssessment:f.after.assessment,beforeIntake:f.before.intake,
   afterIntake:f.after.intake,ledger:f.board,
   evidenceDelta:f.evidenceDelta,riskTrend:f.riskTrend,
   decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
   realPilotAuthorized:false,productionAuthorized:false};
  writeFileSync(join(tmp,'r194.json'),JSON.stringify(input)+'\n');
  const result=execFileSync(process.execPath,[script,'--input','r194.json',
   '--out','audit195'],{cwd:tmp,encoding:'utf8',timeout:15000});
  assert.match(result,/NO-GO/);
  assert.ok(existsSync(join(tmp,'audit195','index.html')));
  assert.ok(existsSync(join(tmp,'audit195','report.md')));
  const html=readFileSync(join(tmp,'audit195','index.html'),'utf8');
  assert.ok(html.includes('r195-import')&&html.includes('NO-GO'));
  for(const owner of ['SECURITY','GOVERNANCE','DEVOPS','ENGINEERING','PRIVACY','OPERATIONS']){
   assert.ok(existsSync(join(tmp,'audit195','handoffs',owner+'.md')));
   assert.ok(existsSync(join(tmp,'audit195','handoffs',owner+'.csv')));
  }
  const manifest=JSON.parse(readFileSync(join(tmp,'audit195','handoffs','manifest.json'),'utf8'));
  assert.equal(manifest.decision,'NO_GO');
  assert.equal(manifest.ownerHashes.length,6);
  assert.throws(()=>execFileSync(process.execPath,[script,
   '--input','../r194.json','--out','newbox'],
   {cwd:tmp,encoding:'utf8',stdio:'pipe',timeout:12000}),/Command failed/);
  assert.equal(existsSync(join(tmp,'newbox')),false);
 }finally{rmSync(tmp,{force:true,recursive:true});}
});
test('R195 actual HTML and draft exports have bounded content and forbid hidden remote behavior',async()=>{
 const f=await fixture(),r=renderR195Dashboard(fromFixture(f));
 assert.ok(r.html.length<240000);
 assert.ok(r.markdown.length<20000);
 assert.ok(!r.html.includes('<iframe'));
 assert.ok(!r.html.includes('XMLHttpRequest'));
 assert.ok(!r.html.includes('navigator.sendBeacon'));
 assert.ok(!r.html.includes('localStorage'));
 assert.ok(r.html.includes('role="status"'));
 const draftRef={sourceCommit:commit,assessmentSha256:f.after.assessment.evidenceSha256,
  initialProgress:f.board.progress};
 const p=await draft.create(draftRef);
 assert.equal((await draft.verify(p,draftRef)),true);
 assert.equal(draft.IDS.length,8);
});
