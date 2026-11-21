/**
 * R185 source-bound pilot preflight: inherited real PostgreSQL17 R184 NO-GO,
 * new actionable staging intake, synthetic canary rehearsal and portable,
 * strictly redacted evidence. This can only issue a new durable NO-GO.
 */
import {createHash} from 'node:crypto';
import {verifyR185SafeEvidence} from './safe-evidence.mjs';
const fail=m=>{throw Error('R185 pilot gate: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fields=['runId','sequence','nonce','sourceCommit',
 'r184EvidenceSha256','decision','productionAuthorized'];
const valid=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 H32.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
 H64.test(x.r184EvidenceSha256||'')&&
 x.decision==='NO_GO_REAL_STAGING_EVIDENCE_PENDING'&&
 x.productionAuthorized===false;
const eq=(a,b)=>valid(a)&&valid(b)&&fields.every(k=>a[k]===b[k]);
const verified=x=>{
 if(!x||Object.getPrototypeOf(x)!==Object.prototype)return false;
 const {evidenceSha256,...body}=x;
 return H64.test(evidenceSha256||'')&&evidenceSha256===sha(body);
};
export function createR185PilotGate({readR184Hold,quarantine,
 clock=()=>Date.now(),allowInspect=false}={}){
 ok(typeof readR184Hold==='function'&&
  typeof quarantine?.status==='function'&&typeof clock==='function',
  'native PostgreSQL R184 readback and quarantine reader required');
 async function inspect({commit,bundleSha256,r184Report,intake,
  rehearsal,safeBytes,safeFileSha256}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&H64.test(bundleSha256||''),
   'real R184 source-bound preflight disabled');
  const before=await readR184Hold();
  const barrier=await quarantine.status();
  ok(valid(before)&&before.sourceCommit===commit&&
   barrier?.closed===true&&Number.isSafeInteger(barrier.generation)&&
   barrier.generation>=5,'source R184 hold or closed quarantine missing');
  const prior=r184Report?.pilotProof;
  ok(r184Report?.schemaVersion===1&&r184Report.commit===commit&&
   r184Report.sourceBundleSha256===bundleSha256&&
   prior?.sourceCommit===commit&&
   prior.sourceBundleSha256===bundleSha256&&
   prior.runId===before.runId&&prior.sequence===before.sequence&&
   prior.nonce===before.nonce&&
   prior.evidenceSha256===before.r184EvidenceSha256&&
   prior.decision===before.decision&&
   prior.sourceMode==='CI_SYNTHETIC'&&
   prior.realPilotAuthorized===false&&prior.productionAuthorized===false&&
   verified(prior)&&
   r184Report.realPg17SnapshotExcludedTwentyFour===true&&
   r184Report.realPg17NativeBackupRestoredNoGoRls===true&&
   r184Report.realPg17ReplayRejected===true&&
   r184Report.syntheticGithubReviewPagination===true&&
   r184Report.syntheticAwsPolicyDenySimulation===true&&
   r184Report.realGithubHumanApproversVerified===false&&
   r184Report.realAwsEffectiveRightsVerified===false&&
   r184Report.realProductionRpoRtoVerified===false&&
   r184Report.realPilotAuthorized===false&&
   r184Report.productionAuthorized===false,
   'R184 native source, audit provenance or CI-only claims changed');
  const now=clock();
  ok(intake?.sourceCommit===commit&&
   intake.sourceBundleSha256===bundleSha256&&
   intake.r184EvidenceSha256===before.r184EvidenceSha256&&
   intake.runId===before.runId&&
   intake.decision==='NO_GO_ACTIONABLE_STAGING_REQUIREMENTS'&&
   intake.blockedCount===5&&
   intake.blockers?.length===5&&
   intake.quarantineClosed===true&&
   intake.quarantineGeneration===barrier.generation&&
   intake.realProviderIndependentlyAttested===false&&
   intake.realHumansIndependentlyVerified===false&&
   intake.realPilotAuthorized===false&&intake.productionAuthorized===false&&
   now>=intake.observedAtMs&&now<=intake.expiresAtMs&&
   verified(intake),
   'actionable intake missing, unbound, stale or falsely approved');
  ok(rehearsal?.sourceCommit===commit&&
   rehearsal.sourceBundleSha256===bundleSha256&&
   rehearsal.intakeEvidenceSha256===intake.evidenceSha256&&
   rehearsal.runId===before.runId&&
   rehearsal.scope==='synthetic-staging-canary-rehearsal-only'&&
   rehearsal.injection==='NONE'&&
   rehearsal.windowsAnalyzed===4&&
   rehearsal.failureReason==='NONE'&&
   rehearsal.stopped===true&&
   rehearsal.simulatedRollbackVerified===true&&
   rehearsal.quarantineRemainsClosed===true&&
   rehearsal.actualTrafficRouted===false&&
   rehearsal.actualDeploymentAttempted===false&&
   rehearsal.realIncidentRecoveryProven===false&&
   rehearsal.realPilotAuthorized===false&&
   rehearsal.productionAuthorized===false&&
   rehearsal.decision==='NO_GO_REHEARSAL_COMPLETED'&&
   now>=rehearsal.observedAtMs&&now-rehearsal.observedAtMs<=60000&&
   verified(rehearsal),
   'only completed isolated synthetic rehearsal can be recorded');
  const check=verifyR185SafeEvidence({
   bytes:safeBytes,commit,bundleSha256,
   expectedFileSha256:safeFileSha256
  });
  const o=JSON.parse(safeBytes.toString('utf8'));
  ok(check.verified===true&&o.runId===before.runId&&
   o.r184EvidenceSha256===before.r184EvidenceSha256&&
   o.intakeEvidenceSha256===intake.evidenceSha256&&
   o.rehearsalEvidenceSha256===rehearsal.evidenceSha256&&
   o.rehearsalFailed===false&&o.simulatedWindowCount===4&&
   o.realPilotAuthorized===false&&o.productionAuthorized===false,
   'portable nonsecret evidence does not match source proofs');
  const after=await readR184Hold(),q=await quarantine.status();
  ok(eq(before,after)&&q?.closed===true&&
   q.generation===barrier.generation,
   'native R184 high-water or quarantine changed during inspection');
  const packet={
   schemaVersion:1,scope:'real-pg17-synthetic-staging-no-go',
   sourceMode:'CI_SYNTHETIC',
   decision:'NO_GO_STAGING_BLOCKERS_UNRESOLVED',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:before.runId,sequence:before.sequence,nonce:before.nonce,
   r184EvidenceSha256:before.r184EvidenceSha256,
   intakeEvidenceSha256:intake.evidenceSha256,
   rehearsalEvidenceSha256:rehearsal.evidenceSha256,
   safeEvidenceSha256:o.evidenceSha256,
   safeFileSha256,blockingCount:5,
   syntheticCanaryWindows:4,
   rollbackSimulationVerified:true,
   quarantineClosed:true,quarantineGeneration:q.generation,
   realProviderIndependentlyAttested:false,
   realHumanApprovalsVerified:false,
   realProductionRecoveryVerified:false,
   realPilotAuthorized:false,productionAuthorized:false,
   observedAtMs:clock()
  };
  return Object.freeze({...packet,evidenceSha256:sha(packet)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,readOnly:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
