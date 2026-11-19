/**
 * R183 pilot hold gate: source-bound R182 + exact default IAM boundary,
 * two HEAD PR review events and synthetic PG17 post-backup delta.
 * No synthetic fixture, PR review or read-only AWS check can return GO.
 */
import {createHash} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R183 pilot gate: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const fields=['runId','sequence','nonce','sourceCommit',
 'r182EvidenceSha256','decision','productionAuthorized'];
const valid=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 H32.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
 H64.test(x.r182EvidenceSha256||'')&&
 x.decision==='NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
 x.productionAuthorized===false;
const same=(a,b)=>valid(a)&&valid(b)&&fields.every(k=>a[k]===b[k]);
const digest=(a,canonical=false)=>{
 const {evidenceSha256,...body}=a||{};
 return typeof evidenceSha256==='string'&&H64.test(evidenceSha256)&&
  evidenceSha256===sha(canonical?canon(body):body);
};
export function createR183PilotGate({readR182Witness,
 quarantine,clock=()=>Date.now(),allowInspect=false}={}){
 ok(typeof readR182Witness==='function'&&
  typeof quarantine?.status==='function'&&typeof clock==='function',
  'true native PostgreSQL R182 receipt and quarantine required');
 async function inspect({r182Report,boundaryProof,prReviewProof,
  deltaProof,commit,bundleSha256}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&H64.test(bundleSha256||''),
   'read-only source bound NO-GO inspection disabled');
  const w=await readR182Witness(),guard=await quarantine.status();
  ok(valid(w)&&w.sourceCommit===commit&&
   guard?.closed===true&&
   Number.isSafeInteger(guard.generation)&&guard.generation>=5,
   'R182 immutable NO-GO or closed isolation barrier missing');
  const prior=r182Report?.readinessProof;
  ok(r182Report?.schemaVersion===1&&r182Report.commit===commit&&
   r182Report.sourceBundleSha256===bundleSha256&&
   r182Report.realPg17TwoNativeRestores===true&&
   r182Report.realPg17RlsAndNoGoAuditParity===true&&
   r182Report.realPg17RestoredDbReplayDenied===true&&
   r182Report.syntheticIamApiObservations===true&&
   r182Report.realIamRightsIndependentlyVerified===false&&
   r182Report.realProductionRpoRtoVerified===false&&
   r182Report.realGithubApproversVerified===false&&
   r182Report.productionAuthorized===false&&
   prior?.schemaVersion===1&&prior.sourceCommit===commit&&
   prior.sourceBundleSha256===bundleSha256&&
   prior.runId===w.runId&&prior.sequence===w.sequence&&
   prior.nonce===w.nonce&&
   prior.evidenceSha256===w.r182EvidenceSha256&&
   prior.decision===w.decision&&prior.productionAuthorized===false&&
   digest(prior),
   'R182 source evidence or synthetic provenance was altered');
  const now=clock(),iam=r182Report.iamProof;
  ok(boundaryProof?.schemaVersion===1&&
   boundaryProof.commit===commit&&
   boundaryProof.bundleSha256===bundleSha256&&
   boundaryProof.iamEvidenceSha256===iam.evidenceSha256&&
   boundaryProof.source?.accountId===prior.sourceAccountId&&
   boundaryProof.offsite?.accountId===prior.offsiteAccountId&&
   boundaryProof.twoDefaultBoundaryPolicyDocumentsMatched===true&&
   boundaryProof.source?.exactDefaultBoundaryPolicyObserved===true&&
   boundaryProof.offsite?.exactDefaultBoundaryPolicyObserved===true&&
   boundaryProof.iamEffectivePermissionsIndependentlyVerified===false&&
   boundaryProof.organizationScpAndResourcePoliciesVerified===false&&
   boundaryProof.actualCloudProviderIndependentlyAuthenticated===false&&
   boundaryProof.naturalHumanApprovalsVerified===false&&
   boundaryProof.productionAuthorized===false&&
   Number.isSafeInteger(boundaryProof.checkedAtMs)&&
   now>=boundaryProof.checkedAtMs&&now<=boundaryProof.expiresAtMs&&
   boundaryProof.expiresAtMs-boundaryProof.checkedAtMs===60000&&
   digest(boundaryProof,true),
   'two-account IAM boundary content missing, stale or promoted');
  ok(prReviewProof?.schemaVersion===1&&
   prReviewProof.commit===commit&&prReviewProof.pullRequest===168&&
   prReviewProof.branch==='feature/marcosa-r150-growth-economics'&&
   prReviewProof.base==='feature/series-pilot-r149'&&
   prReviewProof.verifiedCommitSignatureObserved===true&&
   prReviewProof.exactTwoHeadPrReviewEventsObserved===true&&
   Array.isArray(prReviewProof.reviewers)&&
   prReviewProof.reviewers.length>=2&&
   new Set(prReviewProof.reviewers.map(x=>x.reviewerId)).size===
    prReviewProof.reviewers.length&&
   prReviewProof.independentNaturalHumanIdentityVerified===false&&
   prReviewProof.realGitHubProviderIndependentlyAttested===false&&
   prReviewProof.approvedToDeploy===false&&
   prReviewProof.productionAuthorized===false&&
   Number.isSafeInteger(prReviewProof.checkedAtMs)&&
   now>=prReviewProof.checkedAtMs&&now<=prReviewProof.expiresAtMs&&
   prReviewProof.expiresAtMs-prReviewProof.checkedAtMs===60000&&
   digest(prReviewProof),
   'two exact-head pull-request review events missing or stale');
  ok(deltaProof?.schemaVersion===1&&
   deltaProof.scope==='disposable-postgres17-synthetic-delta-only'&&
   deltaProof.sourceCommit===commit&&
   deltaProof.sourceBundleSha256===bundleSha256&&
   deltaProof.runId===w.runId&&deltaProof.sequence===w.sequence&&
   deltaProof.nonce===w.nonce&&
   deltaProof.r182EvidenceSha256===w.r182EvidenceSha256&&
   deltaProof.baselineMarkerSha256===sha('r183-base:'+commit+':'+w.runId)&&
   deltaProof.afterBackupMarkerSha256===sha('r183-late:'+commit+':'+w.runId)&&
   deltaProof.postBackupSourceMarkerCount===2&&
   deltaProof.restoredSnapshotMarkerCount===1&&
   deltaProof.intentionallyMissingPostBackupEvents===1&&
   Number.isSafeInteger(deltaProof.measuredDisposableRestoreMs)&&
   deltaProof.measuredDisposableRestoreMs>=1&&
   deltaProof.measuredDisposableRestoreMs<=deltaProof.configuredTestBudgetMs&&
   deltaProof.productionDataLossMeasured===false&&
   deltaProof.realProductionRpoRtoVerified===false&&
   deltaProof.quarantineRemainsClosed===true&&
   deltaProof.productionAuthorized===false&&
   deltaProof.decision==='NO_GO_SYNTHETIC_DELTA_ONLY'&&
   digest(deltaProof),
   'real RPO claim, corrupt marker, or missing disposable delta evidence');
  const after=await readR182Witness(),qAfter=await quarantine.status();
  ok(same(w,after)&&qAfter?.closed===true&&
   qAfter.generation===guard.generation,
   'R182 source high-water or quarantine changed during readiness evaluation');
  const record={
   schemaVersion:1,scope:'ci-synthetic-pilot-readiness-hold',
   sourceMode:'CI_SYNTHETIC',
   decision:'NO_GO_REAL_PILOT_EVIDENCE_PENDING',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:w.runId,sequence:w.sequence,nonce:w.nonce,
   r182EvidenceSha256:w.r182EvidenceSha256,
   boundaryEvidenceSha256:boundaryProof.evidenceSha256,
   prReviewEvidenceSha256:prReviewProof.evidenceSha256,
   deltaEvidenceSha256:deltaProof.evidenceSha256,
   baselineMarkerSha256:deltaProof.baselineMarkerSha256,
   afterBackupMarkerSha256:deltaProof.afterBackupMarkerSha256,
   sourceAccountId:prior.sourceAccountId,
   offsiteAccountId:prior.offsiteAccountId,
   syntheticLostDeltaEvents:1,
   isolatedMeasuredRestoreMs:deltaProof.measuredDisposableRestoreMs,
   realProviderAttestationVerified:false,
   realIndependentHumanApprovalsVerified:false,
   effectiveIamRightsVerified:false,
   productionRpoRtoVerified:false,
   realPilotAuthorized:false,
   quarantineRemainsClosed:true,
   productionAuthorized:false,observedAtMs:clock()
  };
  return Object.freeze({...record,evidenceSha256:sha(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,readOnly:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
