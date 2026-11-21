import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createR185StagingIntake,R185_REQUIRED_EVIDENCE_KINDS}
 from '../r185/readiness-intake.mjs';
import {createR185PilotRehearsal,R185_REHEARSAL_PHASES}
 from '../r185/pilot-rehearsal.mjs';
import {buildR185SafeEvidence,verifyR185SafeEvidence}
 from '../r185/safe-evidence.mjs';
import {createR185PilotGate} from '../r185/pilot-gate.mjs';
import {r185HoldSql,createR185HoldLedger}
 from '../r185/hold-ledger.mjs';
const sha=x=>createHash('sha256').update(
 typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const clock=()=>1800000000000,now=clock();
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 runId=123456789,nonce='c'.repeat(32);
const r184Raw={
 schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
 runId,sequence:3,nonce,sourceMode:'CI_SYNTHETIC',
 decision:'NO_GO_REAL_STAGING_EVIDENCE_PENDING',
 realPilotAuthorized:false,productionAuthorized:false
};
const prior={...r184Raw,evidenceSha256:sha(r184Raw)};
const witness={
 runId,sequence:3,nonce,sourceCommit:commit,
 r184EvidenceSha256:prior.evidenceSha256,
 decision:prior.decision,productionAuthorized:false
};
const report={
 schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
 pilotProof:prior,
 realPg17SnapshotExcludedTwentyFour:true,
 realPg17NativeBackupRestoredNoGoRls:true,
 realPg17ReplayRejected:true,
 syntheticGithubReviewPagination:true,
 syntheticAwsPolicyDenySimulation:true,
 realGithubHumanApproversVerified:false,
 realAwsEffectiveRightsVerified:false,
 realProductionRpoRtoVerified:false,
 realPilotAuthorized:false,productionAuthorized:false
};
const surfaces=R185_REQUIRED_EVIDENCE_KINDS.map((kind,i)=>({
 kind,mode:'CI_SYNTHETIC',evidenceSha256:String(i+1).repeat(64),
 observedAtMs:now-1000,expiresAtMs:now+59000
}));
const windows=R185_REHEARSAL_PHASES.map(phase=>({
 phase,requests:1000,errors:1,p95Ms:155
}));
function good(){
 const intake=createR185StagingIntake({
  clock,allowInspect:true}).inspect({commit,bundleSha256,runId,
  r184EvidenceSha256:prior.evidenceSha256,
  providerEvidence:surfaces,quarantineClosed:true,
  quarantineGeneration:5,priorDecision:prior.decision,
  disposableRecovery:{mode:'DISPOSABLE_PG17',
   measuredRestoreMs:1200,syntheticExcludedEvents:24}});
 const rehearsal=createR185PilotRehearsal({
  clock,allowSynthetic:true}).run({
   commit,bundleSha256,runId,intakeProof:intake,windows});
 const safe=buildR185SafeEvidence({intake,rehearsal});
 return{intake,rehearsal,safe};
}
async function gate(opts={}){
 const p=good();
 let reads=0,guards=0;
 const reader=async()=>{
  reads++;return opts.race&&reads>=2?{
   ...witness,sequence:4}:witness;
 };
 const quarantine={status:async()=>{
  guards++;return{closed:!opts.open,generation:opts.generationJump&&
   guards===2?6:5};
 }};
 const g=createR185PilotGate({
  readR184Hold:reader,quarantine,clock,allowInspect:true});
 const r=opts.forgeIntake?{...p.intake,realPilotAuthorized:true}:p.intake;
 const rehearsal=opts.forgeRehearsal?{
  ...p.rehearsal,actualTrafficRouted:true}:p.rehearsal;
 const copied=opts.tamperSafe?
  Buffer.from(p.safe.bytes.toString('utf8').replace(
   'NO_GO_ACTIONABLE_STAGING_REQUIREMENTS',
   'NO_GO_STAGING_BLOCKERS_UNRESOLVED')):p.safe.bytes;
 return g.inspect({commit,bundleSha256,r184Report:report,
  intake:r,rehearsal,safeBytes:copied,
  safeFileSha256:p.safe.sha256});
}
test('R185 typed intake rejects stale/unknown/duplicate provider evidence and false live attestation',()=>{
 const p=good().intake;
 assert.equal(p.blockedCount,5);
 assert.equal(p.providerEvidence.length,4);
 assert.equal(p.decision,'NO_GO_ACTIONABLE_STAGING_REQUIREMENTS');
 assert.equal(p.realPilotAuthorized,false);
 const base={commit,bundleSha256,runId,
  r184EvidenceSha256:prior.evidenceSha256,
  providerEvidence:surfaces,quarantineClosed:true,
  quarantineGeneration:5,priorDecision:prior.decision,
  disposableRecovery:{mode:'DISPOSABLE_PG17',
   measuredRestoreMs:1200,syntheticExcludedEvents:24}};
 const inspector=createR185StagingIntake({clock,allowInspect:true});
 for(const patch of [
  {quarantineClosed:false},{priorDecision:'GO'},
  {providerEvidence:surfaces.slice(0,3)},
  {providerEvidence:[...surfaces.slice(0,3),surfaces[0]]},
  {providerEvidence:surfaces.map((x,i)=>i?x:{...x,mode:'INDEPENDENTLY_VERIFIED'})},
  {providerEvidence:surfaces.map((x,i)=>i?x:{...x,expiresAtMs:now-1})},
  {disposableRecovery:{...base.disposableRecovery,mode:'PRODUCTION_PG17'}}
 ])assert.throws(()=>inspector.inspect({...base,...patch}),/R185 intake/);
});
test('R185 synthetic canary runs SLO windows, always closes & rehearses rollback',()=>{
 const p=good();
 assert.equal(p.rehearsal.decision,'NO_GO_REHEARSAL_COMPLETED');
 assert.equal(p.rehearsal.windowsAnalyzed,4);
 assert.equal(p.rehearsal.stopped,true);
 assert.equal(p.rehearsal.simulatedRollbackVerified,true);
 assert.equal(p.rehearsal.actualTrafficRouted,false);
 assert.equal(p.rehearsal.productionAuthorized,false);
 for(const injection of ['ERROR_SPIKE','LATENCY_SPIKE','MANUAL_STOP','STALE_SOURCE']){
  const simulated=createR185PilotRehearsal({clock,allowSynthetic:true})
   .run({commit,bundleSha256,runId,intakeProof:p.intake,
    windows,injection});
  assert.equal(simulated.decision,'NO_GO_REHEARSAL_ABORTED');
  assert.equal(simulated.windowsAnalyzed,2);
  assert.equal(simulated.transitions.at(-1).state,'VERIFIED');
  assert.equal(simulated.actualDeploymentAttempted,false);
 }
 const w=windows.map(x=>({...x}));
 w[2].errors=100;
 const failed=createR185PilotRehearsal({clock,allowSynthetic:true})
 .run({commit,bundleSha256,runId,intakeProof:p.intake,windows:w});
 assert.equal(failed.failureReason,'ERROR_BUDGET_EXCEEDED');
 assert.equal(failed.productionAuthorized,false);
});
test('R185 canonical safe evidence rejects leaked secrets, noncanonical JSON, and false deployment',()=>{
 const p=good();
 assert.equal(p.safe.packet.requiredBlockingChecks.length,5);
 assert.equal(p.safe.packet.productionAuthorized,false);
 const verified=verifyR185SafeEvidence({bytes:p.safe.bytes,
  commit,bundleSha256,expectedFileSha256:p.safe.sha256});
 assert.equal(verified.verified,true);
 const altered=Buffer.from(p.safe.bytes.toString('utf8').replace(
  'NO_GO_ACTIONABLE_STAGING_REQUIREMENTS','PRODUCTION_GO'));
 assert.throws(()=>verifyR185SafeEvidence({bytes:altered,
  commit,bundleSha256,expectedFileSha256:sha(altered)}),
 /R185 safe evidence/);
 const spaced=Buffer.from(' '+p.safe.bytes.toString('utf8'));
 assert.throws(()=>verifyR185SafeEvidence({bytes:spaced,
  commit,bundleSha256,expectedFileSha256:sha(spaced)}),
 /R185 safe evidence/);
 const bad={...p.intake,clientSecret:'ghp_'+('A'.repeat(35))};
 const {evidenceSha256,...body}=bad;
 bad.evidenceSha256=sha(body);
 assert.throws(()=>buildR185SafeEvidence({
  intake:bad,rehearsal:p.rehearsal}),/R185 safe evidence/);
});
test('R185 source-bound gate denies race, lifted quarantine, synthetic promotion, modified report',async()=>{
 const r=await gate();
 assert.equal(r.decision,'NO_GO_STAGING_BLOCKERS_UNRESOLVED');
 assert.equal(r.blockingCount,5);
 assert.equal(r.syntheticCanaryWindows,4);
 assert.equal(r.quarantineClosed,true);
 assert.equal(r.realPilotAuthorized,false);
 assert.equal(r.productionAuthorized,false);
 for(const patch of [{race:true},{open:true},{generationJump:true},
  {forgeIntake:true},{forgeRehearsal:true},{tamperSafe:true}])
 await assert.rejects(gate(patch),
  /R185 pilot gate|R185 safe evidence/,JSON.stringify(patch));
});
test('R185 serializable immutable PG17 R184 predecessor + audit denies GO and replay',async()=>{
 const e=await gate(),s=r185HoldSql(e);
 for(const token of ['SERIALIZABLE','marcosa_r185_writer',
  'r184_ci.pilot_holds','r184_ci.pilot_audit',
  'r185_ci.readiness_holds','r185_ci.readiness_audit',
  'ON CONFLICT DO NOTHING'])
 assert.ok(s.includes(token),token);
 for(const p of [{decision:'PRODUCTION_GO'},
  {productionAuthorized:true},{nonce:"' OR 1=1"},
  {sourceMode:'MANUAL_READONLY'},{blockingCount:0},
  {rehearsalEvidenceSha256:'bad'}])
 assert.throws(()=>r185HoldSql({...e,...p}),/R185 ledger/);
 let i=0;
 const ledger=createR185HoldLedger({executeSql:async()=>i++===0?
  'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'});
 assert.equal((await ledger.record(e)).recorded,true);
 await assert.rejects(ledger.record(e),/R185 ledger/);
});
