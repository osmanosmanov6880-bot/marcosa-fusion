import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createR194TaskLedger,appendR194TaskEvent,verifyR194TaskLedger}
 from '../r194/task-ledger.mjs';
import {compareR194Evidence} from '../r194/evidence-delta.mjs';
import {compareR194Readiness} from '../r194/risk-trend.mjs';
import {renderR194Interactive} from '../r194/interactive-dashboard.mjs';
import {buildR194Fixture} from '../r194/fixture.mjs';
import {createR194Package,verifyR194Package} from '../r194/portable-package.mjs';
import {sealReceipt} from '../r190/common.mjs';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const now=Date.now(),clock=()=>now;
const opts={commit,bundleSha256,now};
test('R194 task ledger chains genuine source hashes, enforces transitions and never issues GO',async()=>{
 const f=await buildR194Fixture(opts);
 assert.equal(f.board.events.length,2);
 assert.equal(f.board.progress.TLS_ORIGIN,'BLOCKED_LOCAL');
 assert.equal(f.board.progress.AWS_EFFECTIVE_RIGHTS,'OPEN');
 assert.equal(f.board.productionAuthorized,false);
 assert.deepEqual(verifyR194TaskLedger({ledger:f.board,
  assessment:f.after.assessment,commit,bundleSha256}),f.board);
 assert.throws(()=>appendR194TaskEvent({ledger:f.board,
  assessment:f.after.assessment,commit,bundleSha256,
  control:'TLS_ORIGIN',action:'COMPLETE',clock}),/invalid or too many/);
 const reopened=appendR194TaskEvent({ledger:f.board,
  assessment:f.after.assessment,commit,bundleSha256,
  control:'TLS_ORIGIN',action:'REOPEN',clock});
 assert.equal(reopened.events.length,3);
 assert.equal(reopened.progress.TLS_ORIGIN,'OPEN');
 const broken={...f.board,progress:{...f.board.progress,TLS_ORIGIN:'DONE_LOCAL'}};
 assert.throws(()=>verifyR194TaskLedger({ledger:broken,
  assessment:f.after.assessment,commit,bundleSha256}),/tampered/);
 const fakeEvent={...f.board.events[0],owner:'OWNER_GO'};
 const fakeBoard={...f.board,events:[fakeEvent,...f.board.events.slice(1)]};
 assert.throws(()=>verifyR194TaskLedger({ledger:fakeBoard,
  assessment:f.after.assessment,commit,bundleSha256}),/tampered/);
});
test('R194 evidence revisions detect conflicts, replacement, missing claims and reject mixed sources',async()=>{
 const f=await buildR194Fixture(opts);
 assert.equal(f.evidenceDelta.changedCount,2);
 assert.equal(f.evidenceDelta.withdrawnCount,0);
 assert.equal(f.evidenceDelta.productionAuthorized,false);
 const tls=f.evidenceDelta.changes.find(x=>x.control==='TLS_ORIGIN');
 const restore=f.evidenceDelta.changes.find(x=>x.control==='STAGING_RESTORE');
 assert.equal(tls.state,'HASH_AND_CLAIM_CHANGED');
 assert.equal(restore.state,'ADDED');
 assert.equal(tls.stillUnverified,true);
 assert.throws(()=>compareR194Evidence({commit,bundleSha256,
  before:f.after.intake,after:f.before.intake,clock}),/stale, reordered/);
 assert.throws(()=>compareR194Evidence({commit,bundleSha256,
  before:f.before.intake,
  after:{...f.after.intake,sourceCommit:'f'.repeat(40)},
  clock}),/invalid R193_INTAKE/);
 const withdrawnRecords=f.after.intake.records.filter(r=>r.control!=='TLS_ORIGIN');
 const before=f.before.intake;
 const after=sealReceipt({...Object.fromEntries(Object.entries(f.after.intake)
  .filter(([k])=>k!=='evidenceSha256')),records:withdrawnRecords});
 const diff=compareR194Evidence({commit,bundleSha256,before,after,clock});
 assert.equal(diff.changes.find(x=>x.control==='TLS_ORIGIN').state,'WITHDRAWN');
});
test('R194 trend reports regression and claimed improvement; no risk score grants production',async()=>{
 const f=await buildR194Fixture(opts);
 assert.ok(f.riskTrend.regressions.includes('TLS_ORIGIN'));
 assert.ok(f.riskTrend.reportedImprovements.includes('STAGING_RESTORE'));
 assert.equal(f.riskTrend.stillRequireExternalApproval.length,8);
 assert.equal(f.riskTrend.productionAuthorized,false);
 assert.equal(f.riskTrend.decision,'NO_GO_TREND_IS_NOT_INDEPENDENT_APPROVAL');
 assert.throws(()=>compareR194Readiness({commit,bundleSha256,
  before:f.after.assessment,after:f.before.assessment,clock}),/stale/);
});
test('R194 actual offline interactive HTML: CSP script SHA, controls, responsive layout and NO-GO',async()=>{
 const f=await buildR194Fixture(opts);
 const html=f.rendered.html;
 assert.ok(html.includes('lang="ru"')&&html.includes('name="viewport"'));
 assert.ok(html.includes('script-src &#39;sha256-'));
 assert.ok(html.includes("connect-src &#39;none&#39;"));
 assert.ok(html.includes('r194-search'));
 assert.ok(html.includes('r194-filter'));
 assert.ok(html.includes('r194-export'));
 assert.ok(html.includes('r194-import'));
 assert.ok(html.includes('r194-reset'));
 assert.ok(html.includes('id="r194-source" hidden'));
 assert.equal((html.match(/class="control" id=/g)||[]).length,8);
 assert.ok(html.includes('@media(max-width:780px)'));
 assert.ok(!html.includes('src="https:'));
 assert.ok(!html.includes('onclick='));
 assert.ok(!html.includes('onerror='));
 assert.ok(html.includes('<strong>NO-GO</strong>'));
 assert.equal(f.rendered.decision,'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED');
 assert.equal(f.rendered.productionAuthorized,false);
 const foreign={...f.evidenceDelta,afterSha256:'c'.repeat(64)};
 assert.throws(()=>renderR194Interactive({commit,bundleSha256,
  assessment:f.after.assessment,ledger:f.board,
  evidenceDelta:foreign,riskTrend:f.riskTrend}),/tampered/);
});
test('R194 pinned Ed25519 public key + exact git source + deterministic re-render',async()=>{
 const f=await buildR194Fixture(opts);
 const p=createR194Package({commit,bundleSha256,
  beforeIntake:f.before.intake,afterIntake:f.after.intake,
  beforeAssessment:f.before.assessment,afterAssessment:f.after.assessment,
  ledger:f.board,evidenceDelta:f.evidenceDelta,riskTrend:f.riskTrend,
  privateKey:f.keyPair.privateKey,publicKeyDer:f.publicKeyDer,clock});
 const verification={bytes:p.bytes,signature:p.signature,
  publicKeyDer:f.publicKeyDer,expectedPublicKeySha256:p.keySha256,
  expectedFileSha256:p.fileSha256,
  expectedHtmlSha256:p.rendered.htmlSha256,
  expectedMarkdownSha256:p.rendered.markdownSha256,
  commit,bundleSha256,clock};
 const result=verifyR194Package(verification);
 assert.equal(result.verified,true);
 assert.equal(result.productionAuthorized,false);
 const tampered=Buffer.from(p.bytes);tampered[77]^=1;
 assert.throws(()=>verifyR194Package({...verification,bytes:tampered}),/changed/);
 const wrongSig=Buffer.from(p.signature);wrongSig[20]^=1;
 assert.throws(()=>verifyR194Package({...verification,signature:wrongSig}),/signature/);
 const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'});
 assert.throws(()=>verifyR194Package({...verification,
  publicKeyDer:other}),/key pin/);
 assert.throws(()=>verifyR194Package({...verification,
  expectedHtmlSha256:'f'.repeat(64)}),/re-rendered/);
 assert.throws(()=>verifyR194Package({...verification,
  clock:()=>now+3600001}),/stale/);
});
test('R194 CLI converts two genuine R193 report JSONs into actual standalone HTML/MD offline',async()=>{
 const f=await buildR194Fixture(opts);
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r194-'));
 const script=fileURLToPath(new URL('../r194/operator-cli.mjs',import.meta.url));
 try{
  for(const [name,item] of [['before.json',f.before],['after.json',f.after]])
   writeFileSync(join(dir,name),JSON.stringify({github:item.github,
    intake:item.intake,assessment:item.assessment,
    productionAuthorized:false,realPilotAuthorized:false})+'\n');
  const output=execFileSync(process.execPath,[script,
   '--before','before.json','--after','after.json','--out','r194-audit'],
   {cwd:dir,encoding:'utf8',timeout:12000});
  assert.match(output,/NO_GO/);
  assert.equal(existsSync(join(dir,'r194-audit','index.html')),true);
  const html=readFileSync(join(dir,'r194-audit','index.html'),'utf8');
  assert.ok(html.includes('r194-import')&&html.includes('NO-GO'));
  const json=JSON.parse(readFileSync(join(dir,'r194-audit','evidence.json'),'utf8'));
  assert.equal(json.productionAuthorized,false);
  assert.equal(json.ledger.events.length,0);
  assert.throws(()=>execFileSync(process.execPath,[script,
   '--before','../before.json','--after','after.json','--out','r194-other'],
   {cwd:dir,encoding:'utf8',stdio:'pipe',timeout:12000}),/Command failed/);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
