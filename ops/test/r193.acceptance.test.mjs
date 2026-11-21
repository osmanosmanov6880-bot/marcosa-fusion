import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {observeR193Github} from '../r193/github-observer.mjs';
import {ingestR193Evidence,R193_CONTROLS} from '../r193/evidence-intake.mjs';
import {assessR193Readiness} from '../r193/assessment.mjs';
import {renderR193Dashboard} from '../r193/dashboard.mjs';
import {createR193SignedPackage,verifyR193SignedPackage}
 from '../r193/signed-package.mjs';
import {buildR193Fixture,r193FixtureFetch} from '../r193/fixture.mjs';
import {runR193Cli} from '../r193/operator-cli.mjs';
import {sealReceipt} from '../r190/common.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const runId=944044,now=Date.now(),clock=()=>now;
const id={SECURITY:200,OPERATIONS:300,PRIVACY:400};
const args={commit,bundleSha256,runId,
 reviewerIds:id,clock,sourceMode:'CI_FIXTURE',allowNetwork:true};
test('R193 read-only GitHub observer pins source/CI and rejects head drift',async()=>{
 const good=await observeR193Github({...args,
  fetchImpl:r193FixtureFetch({commit,runId,now})});
 assert.equal(good.repository,'osmanosmanov6880-bot/marcosa-fusion');
 assert.equal(good.reviewedRunId,runId);
 assert.equal(good.allThreeApprovalsObserved,false);
 assert.equal(good.productionAuthorized,false);
 assert.equal(good.blockers.filter(s=>s.startsWith('MISSING_')).length,3);
 const full=await observeR193Github({...args,
  fetchImpl:r193FixtureFetch({commit,runId,now,reviewed:true})});
 assert.equal(full.allThreeApprovalsObserved,true);
 await assert.rejects(observeR193Github({...args,
  fetchImpl:r193FixtureFetch({commit,runId,now,headDrift:true})}),/head\/base/);
 await assert.rejects(observeR193Github({...args,
  fetchImpl:r193FixtureFetch({commit,runId,now,invalidContentType:true})}),/unexpected status|response type/);
 await assert.rejects(observeR193Github({...args,
  reviewerIds:{SECURITY:200,OPERATIONS:200,PRIVACY:400},
  fetchImpl:r193FixtureFetch({commit,runId,now})}),/distinct/);
 await assert.rejects(observeR193Github({...args,allowNetwork:false,
  fetchImpl:r193FixtureFetch({commit,runId,now})}),/opt-in/);
});
test('R193 GitHub failed CI and stale claims never become approval',async()=>{
 const g=await observeR193Github({...args,
  fetchImpl:r193FixtureFetch({commit,runId,now,failedRun:true,reviewed:true})});
 assert.equal(g.allThreeApprovalsObserved,true);
 assert.equal(g.runConclusion,'failure');
 assert.ok(g.blockers.includes('TARGET_CI_RUN_NOT_SUCCESS'));
 assert.equal(g.decision,'NO_GO_EXTERNAL_OPERATOR_REVIEW_PENDING');
});
test('R193 evidence intake forbids duplicates, foreign source, expired claims and arbitrary metadata',()=>{
 const base={control:'TLS_ORIGIN',sourceCommit:commit,
  artifactSha256:'c'.repeat(64),authority:'CI_FIXTURE',
  claim:'PASS_CLAIM',observedAtMs:now-1000,expiresAtMs:now+20000};
 const opts={commit,bundleSha256,sourceMode:'CI_FIXTURE',clock};
 const one=ingestR193Evidence({...opts,records:[base]});
 assert.equal(one.acceptedRecordCount,1);
 assert.equal(one.externalArtifactBytesVerified,false);
 for(const bad of [
  [base,base],[{...base,sourceCommit:'f'.repeat(40)}],
  [{...base,expiresAtMs:now-1}],[{...base,claim:'GO'}],
  [{...base,authority:'OPERATOR_OBSERVED_UNVERIFIED'}],
  [{...base,freeText:'password=secret'}]
 ])assert.throws(()=>ingestR193Evidence({...opts,records:bad}),/malformed|duplicated|stale/);
 assert.equal(R193_CONTROLS.length,6);
});
test('R193 reconciler produces eight source-bound actionable NO-GO controls',async()=>{
 const f=await buildR193Fixture({commit,bundleSha256,runId,now});
 const a=f.assessment;
 assert.equal(a.controls.length,8);
 assert.equal(a.tally.blocked,2);
 assert.equal(a.tally.missing,4);
 assert.equal(a.tally.claims,1);
 assert.equal(a.tally.observed,1);
 assert.equal(a.actionQueue.length,7);
 assert.ok(a.actionQueue.every(x=>x.priority<=2));
 assert.ok(a.blockers.includes('PRIVACY_LEGAL'));
 assert.equal(a.pilotEligible,false);
 assert.equal(a.productionAuthorized,false);
 assert.throws(()=>assessR193Readiness({commit,bundleSha256,
  github:{...f.github,runConclusion:'failure'},
  intake:f.intake,clock}),/tampered/);
 assert.throws(()=>assessR193Readiness({commit,bundleSha256,
  github:f.github,intake:f.intake,clock:()=>now+62000}),/expired/);
});
test('R193 synthetic all-pass claims and 3 reviews cannot create GO',async()=>{
 const records=R193_CONTROLS.map(control=>({
  control,sourceCommit:commit,artifactSha256:hash(control),
  authority:'CI_FIXTURE',claim:'PASS_CLAIM',
  observedAtMs:now-1000,expiresAtMs:now+30000
 }));
 const f=await buildR193Fixture({
  commit,bundleSha256,runId,now,reviewed:true,evidenceRecords:records});
 assert.equal(f.assessment.controls.length,8);
 assert.equal(f.assessment.tally.claims,6);
 assert.equal(f.assessment.tally.observed,2);
 assert.equal(f.assessment.decision,'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED');
 assert.ok(f.assessment.controls.every(x=>x.allowedForRelease===false));
});
test('R193 offline dashboard mobile, accessible, deterministic, zero-network & full eight cards',async()=>{
 const f=await buildR193Fixture({commit,bundleSha256,runId,now});
 const r=renderR193Dashboard({assessment:f.assessment,commit,bundleSha256});
 assert.equal(r.html,f.signed.rendered.html);
 assert.ok(r.html.includes('<meta name="viewport"'));
 assert.ok(r.html.includes('lang="ru"'));
 assert.ok(r.html.includes('Content-Security-Policy'));
 assert.ok(r.html.includes('@media(max-width:780px)'));
 assert.ok(r.html.includes('<strong>NO-GO</strong>'));
 assert.ok(r.html.includes('aria-label="Разделы"'));
 assert.ok(!r.html.includes('<script'));
 assert.ok(!r.html.includes('https://'));
 assert.equal((r.html.match(/class="control" id=/g)||[]).length,8);
 assert.ok(r.markdown.includes('## Приоритетная очередь'));
 assert.equal(hash(Buffer.from(r.html)),r.htmlSha256);
 const malicious={...f.assessment,controls:f.assessment.controls.map(
  (x,i)=>i===0?{...x,title:'<img src=x onerror=alert(1)>'}:x)};
 assert.throws(()=>renderR193Dashboard({assessment:malicious,commit,bundleSha256}),
  /tampered/);
});
test('R193 independent Ed25519 signature validates public pin, packet SHA and report re-render',async()=>{
 const f=await buildR193Fixture({commit,bundleSha256,runId,now});
 const p=f.signed;
 const opts={
  bytes:p.bytes,signature:p.signature,
  publicKeyDer:f.publicKeyDer,
  expectedPublicKeySha256:p.publicKeySha256,
  expectedBundleFileSha256:p.bundleFileSha256,
  expectedHtmlSha256:p.rendered.htmlSha256,
  expectedMarkdownSha256:p.rendered.markdownSha256,
  commit,bundleSha256,clock
 };
 const actual=verifyR193SignedPackage(opts);
 assert.equal(actual.verified,true);
 assert.equal(actual.productionAuthorized,false);
 assert.equal(actual.decision,'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED');
 const tampered=Buffer.from(p.bytes);tampered[50]^=1;
 assert.throws(()=>verifyR193SignedPackage({...opts,bytes:tampered}),/changed/);
 const wrongSig=Buffer.from(p.signature);wrongSig[1]^=1;
 assert.throws(()=>verifyR193SignedPackage({...opts,signature:wrongSig}),/signature/);
 const wrongKey=generateKeyPairSync('ed25519').publicKey.export({
  type:'spki',format:'der'});
 assert.throws(()=>verifyR193SignedPackage({...opts,
  publicKeyDer:wrongKey}),/key pin/);
 assert.throws(()=>verifyR193SignedPackage({...opts,
  expectedHtmlSha256:'f'.repeat(64)}),/reports differ/);
 assert.throws(()=>verifyR193SignedPackage({...opts,
  clock:()=>now+3600001}),/expired/);
});
test('R193 CLI has help, blocks unapproved network and filesystem options',async()=>{
 const printed=[];
 const help=await runR193Cli({argv:['--help'],output:s=>printed.push(s)});
 assert.equal(help.help,true);
 assert.match(printed.join('\n'),/read-only/i);
 const fields=['--commit',commit,'--bundle',bundleSha256,
  '--run',String(runId),'--security','200','--operations','300',
  '--privacy','400','--evidence','proof.json','--out','r193-audit'];
 await assert.rejects(runR193Cli({argv:fields,env:{}}),/R193_ALLOW_NETWORK/);
 await assert.rejects(runR193Cli({argv:fields.slice(0,-2).concat(
  ['--out','../danger']),env:{R193_ALLOW_NETWORK:'1'}}),/safe local/);
});
