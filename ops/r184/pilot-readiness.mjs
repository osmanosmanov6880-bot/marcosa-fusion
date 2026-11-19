/**
 * R184 evidence aggregation is deliberately one-way: source-bound
 * synthetic GitHub review, IAM denied write simulations, and measured
 * isolated WAL continuity are useful diagnostic proofs, NEVER authority
 * to open real staging, enable customer traffic, release or production.
 */
import {createHash} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R184 pilot readiness: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=['runId','sequence','nonce','sourceCommit',
 'r183EvidenceSha256','decision','productionAuthorized'];
const valid=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 H32.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
 H64.test(x.r183EvidenceSha256||'')&&
 x.decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
 x.productionAuthorized===false;
const same=(a,b)=>valid(a)&&valid(b)&&
 fields.every(k=>a[k]===b[k]);
function digest(proof){
 if(!proof||Object.getPrototypeOf(proof)!==Object.prototype)return false;
 const {evidenceSha256,...raw}=proof;
 return H64.test(evidenceSha256||'')&&evidenceSha256===sha(raw);
}
export function createR184PilotReadiness({
 readR183Hold,quarantine,clock=()=>Date.now(),allowInspect=false
}={}){
 ok(typeof readR183Hold==='function'&&
  typeof quarantine?.status==='function'&&typeof clock==='function',
  'read-only PG17 predecessor and live quarantine state required');
 async function inspect({r183Report,reviewProof,iamDenyProof,
  continuityProof,commit,bundleSha256}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||''),
   'explicitly enabled source-bound synthetic NO-GO check required');
  const before=await readR183Hold(),guard=await quarantine.status();
  ok(valid(before)&&before.sourceCommit===commit&&
   guard?.closed===true&&Number.isSafeInteger(guard.generation)&&
   guard.generation>=5,
   'PG17 immutable R183 hold missing or source quarantine opened');
  const prior=r183Report?.pilotProof;
  ok(r183Report?.schemaVersion===1&&r183Report.commit===commit&&
   r183Report.sourceBundleSha256===bundleSha256&&
   r183Report.realPg17DeltaSnapshotRestored===true&&
   r183Report.realPg17NoGoAndRlsRestored===true&&
   r183Report.realPg17ReplayDenied===true&&
   r183Report.syntheticAwsBoundaryDocuments===true&&
   r183Report.syntheticGithubPrReviewEvents===true&&
   r183Report.realAwsRightsVerified===false&&
   r183Report.realPrReviewersVerified===false&&
   r183Report.realProductionRpoRtoVerified===false&&
   r183Report.realPilotAuthorized===false&&
   r183Report.productionAuthorized===false&&
   prior?.sourceCommit===commit&&
   prior.sourceBundleSha256===bundleSha256&&
   prior.runId===before.runId&&prior.sequence===before.sequence&&
   prior.nonce===before.nonce&&
   prior.evidenceSha256===before.r183EvidenceSha256&&
   prior.decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
   prior.sourceMode==='CI_SYNTHETIC'&&
   prior.realPilotAuthorized===false&&
   prior.productionAuthorized===false&&digest(prior),
   'prior R183 immutable source, evidence digest or CI synthetic scope drift');
  const now=clock();
  ok(reviewProof?.schemaVersion===1&&
   reviewProof.commit===commit&&
   reviewProof.pullRequest===168&&
   reviewProof.branch==='feature/marcosa-r150-growth-economics'&&
   reviewProof.completeHeadReviewHistoryInspected===true&&
   reviewProof.hiddenChangedRequestsRejected===true&&
   reviewProof.verifiedCommitSignatureObserved===true&&
   Array.isArray(reviewProof.reviewers)&&reviewProof.reviewers.length>=2&&
   new Set(reviewProof.reviewers.map(x=>x.reviewerId)).size===
    reviewProof.reviewers.length&&
   reviewProof.pageCount>=1&&reviewProof.pageCount<=4&&
   reviewProof.reviewEventCount>=2&&reviewProof.reviewEventCount<=400&&
   H64.test(reviewProof.reviewedEventsSha256||'')&&
   reviewProof.independentNaturalHumanIdentityVerified===false&&
   reviewProof.externalProviderIdentityIndependentlyAuthenticated===false&&
   reviewProof.realPilotAuthorized===false&&
   reviewProof.productionAuthorized===false&&
   now>=reviewProof.checkedAtMs&&now<=reviewProof.expiresAtMs&&
   reviewProof.expiresAtMs-reviewProof.checkedAtMs===60000&&
   digest(reviewProof),
   'paginated PR review proof missing, stale or promoted');
  const iam=r183Report.r182Report?.iamProof;
  const boundary=r183Report.boundaryProof;
  ok(iamDenyProof?.schemaVersion===1&&
   iamDenyProof.commit===commit&&
   iamDenyProof.bundleSha256===bundleSha256&&
   iamDenyProof.iamEvidenceSha256===iam?.evidenceSha256&&
   iamDenyProof.boundaryEvidenceSha256===boundary?.evidenceSha256&&
   iamDenyProof.source?.accountId===prior.sourceAccountId&&
   iamDenyProof.offsite?.accountId===prior.offsiteAccountId&&
   iamDenyProof.source?.forbiddenWritesSimulated===10&&
   iamDenyProof.offsite?.forbiddenWritesSimulated===10&&
   iamDenyProof.source?.allWriteSimulationsDenied===true&&
   iamDenyProof.offsite?.allWriteSimulationsDenied===true&&
   iamDenyProof.totalForbiddenWriteActionsChecked===20&&
   iamDenyProof.allSimulatedWriteActionsDenied===true&&
   H64.test(iamDenyProof.source?.decisionSetSha256||'')&&
   H64.test(iamDenyProof.offsite?.decisionSetSha256||'')&&
   iamDenyProof.actualEffectiveIamRightsVerified===false&&
   iamDenyProof.organizationSCPsAndKmsGrantsVerified===false&&
   iamDenyProof.externalProviderIndependentlyAttested===false&&
   iamDenyProof.productionAuthorized===false&&
   now>=iamDenyProof.checkedAtMs&&now<=iamDenyProof.expiresAtMs&&
   iamDenyProof.expiresAtMs-iamDenyProof.checkedAtMs===60000&&
   digest(iamDenyProof),
   'simulation did not reject exactly 20 source-pinned write actions');
  ok(continuityProof?.schemaVersion===1&&
   continuityProof.scope==='disposable-postgres17-only'&&
   continuityProof.sourceCommit===commit&&
   continuityProof.sourceBundleSha256===bundleSha256&&
   continuityProof.runId===before.runId&&
   continuityProof.sequence===before.sequence&&
   continuityProof.nonce===before.nonce&&
   continuityProof.r183EvidenceSha256===before.r183EvidenceSha256&&
   continuityProof.sourceEventCount===32&&
   continuityProof.restoredSnapshotEventCount===8&&
   continuityProof.intentionallyExcludedPostSnapshotEvents===24&&
   H64.test(continuityProof.sourceEventSequenceSha256||'')&&
   H64.test(continuityProof.restoredSequenceSha256||'')&&
   Number.isSafeInteger(continuityProof.observedSourcePostSnapshotWalBytes)&&
   continuityProof.observedSourcePostSnapshotWalBytes>0&&
   Number.isSafeInteger(continuityProof.measuredDisposableRestoreMs)&&
   continuityProof.measuredDisposableRestoreMs>=1&&
   continuityProof.measuredDisposableRestoreMs<=continuityProof.configuredTestBudgetMs&&
   continuityProof.realProductionRpoRtoVerified===false&&
   continuityProof.realProductionEventsExamined===false&&
   continuityProof.closedQuarantinePreserved===true&&
   continuityProof.productionAuthorized===false&&
   continuityProof.decision==='NO_GO_SYNTHETIC_CONTINUITY_WINDOW_ONLY'&&
   digest(continuityProof),
   'restored synthetic data window does not prove live production recovery');
  const after=await readR183Hold(),q2=await quarantine.status();
  ok(same(before,after)&&q2?.closed===true&&
   q2.generation===guard.generation,
   'native PostgreSQL high-water or quarantine moved during pilot check');
  const result={
   schemaVersion:1,scope:'disposable-pg17-provider-synthetic-only',
   sourceMode:'CI_SYNTHETIC',
   decision:'NO_GO_REAL_STAGING_EVIDENCE_PENDING',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:before.runId,sequence:before.sequence,nonce:before.nonce,
   r183EvidenceSha256:before.r183EvidenceSha256,
   reviewHistoryEvidenceSha256:reviewProof.evidenceSha256,
   iamDenyEvidenceSha256:iamDenyProof.evidenceSha256,
   continuityEvidenceSha256:continuityProof.evidenceSha256,
   sourceAccountId:prior.sourceAccountId,
   offsiteAccountId:prior.offsiteAccountId,
   intentionallyMissingEvents:24,
   measuredRestoreMs:continuityProof.measuredDisposableRestoreMs,
   allSimulatedWritesDenied:true,
   fullSyntheticPrHistoryChecked:true,
   realIamEffectivePermissionsVerified:false,
   realGithubHumanApprovalsVerified:false,
   realProductionRpoRtoVerified:false,
   realPilotAuthorized:false,
   closedQuarantinePreserved:true,
   productionAuthorized:false,observedAtMs:clock()
  };
  return Object.freeze({...result,evidenceSha256:sha(result)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,realPilotAuthorized:false,
  productionAuthorized:false})});
}
