/**
 * R182 verified, source-bound NO-GO. Never infer IAM rights, human
 * approvals, live S3 delivery, or production RPO/RTO from CI fixtures.
 */
import {createHash} from 'node:crypto';
const error=m=>{throw Error('R182 readiness barrier: '+m);};
const ok=(v,m)=>{if(!v)error(m);};
const hex40=/^[a-f0-9]{40}$/,hex64=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const stableHash=x=>sha(canon(x));
const fields=['runId','sequence','nonce','sourceCommit',
 'r181EvidenceSha256','r180ClassificationSha256',
 'r180QuorumReceiptSha256','decision','productionAuthorized'];
const valid=w=>w&&Object.getPrototypeOf(w)===Object.prototype&&
 Object.keys(w).sort().join(',')===fields.slice().sort().join(',')&&
 Number.isSafeInteger(w.runId)&&w.runId>=10000&&
 Number.isSafeInteger(w.sequence)&&w.sequence>=2&&w.sequence<=32&&
 /^[a-f0-9]{32}$/.test(w.nonce||'')&&hex40.test(w.sourceCommit||'')&&
 ['r181EvidenceSha256','r180ClassificationSha256',
  'r180QuorumReceiptSha256'].every(k=>hex64.test(w[k]||''))&&
 w.decision==='NO_GO_PROVIDER_ATTESTATION_PENDING'&&
 w.productionAuthorized===false;
const equal=(a,b)=>valid(a)&&valid(b)&&fields.every(k=>a[k]===b[k]);
export function createR182ReadinessBarrier({readR181Witness,quarantine,
 clock=()=>Date.now(),allowInspect=false}={}){
 ok(typeof readR181Witness==='function'&&
  typeof quarantine?.status==='function'&&typeof clock==='function',
  'real R181 PostgreSQL readback and quarantine reader required');
 async function inspect({r181Report,iamProof,drillProof,
  commit,bundleSha256}={}){
  ok(allowInspect===true&&hex40.test(commit||'')&&
   hex64.test(bundleSha256||''),'source pin and explicit NO-GO inspection required');
  const w=await readR181Witness(),q=await quarantine.status();
  ok(valid(w)&&w.sourceCommit===commit&&
   q?.closed===true&&Number.isSafeInteger(q.generation)&&q.generation>=5,
   'source immutable R181 NO-GO or closed quarantine missing');
  const p=r181Report?.observation;
  const {evidenceSha256:sourceSha,...sourceRaw}=p||{};
  ok(r181Report?.schemaVersion===1&&r181Report.commit===commit&&
   r181Report.sourceBundleSha256===bundleSha256&&
   p?.schemaVersion===1&&p.sourceMode==='CI_SYNTHETIC'&&
   p.sourceCommit===commit&&p.sourceBundleSha256===bundleSha256&&
   p.runId===w.runId&&p.sequence===w.sequence&&p.nonce===w.nonce&&
   p.classificationSha256===w.r180ClassificationSha256&&
   p.quorumReceiptSha256===w.r180QuorumReceiptSha256&&
   p.decision===w.decision&&p.productionAuthorized===false&&
   p.actualIndependentProviderAttestation===false&&
   p.naturalPersonSeparationIndependentlyVerified===false&&
   p.restoreRpoRtoAndPrivacyVerified===false&&
   sourceSha===w.r181EvidenceSha256&&sha(sourceRaw)===sourceSha&&
   r181Report.realAwsProvidersIndependentlyAttested===false&&
   r181Report.realHumanReviewersVerified===false&&
   r181Report.productionAuthorized===false,
   'R181 source digest or CI-synthetic provenance falsely elevated');
  const {evidenceSha256:iamSha,...iamRaw}=iamProof||{};
  const current=clock();
  ok(iamProof?.schemaVersion===1&&iamProof.commit===commit&&
   iamProof.bundleSha256===bundleSha256&&
   iamProof.source?.accountId===p.sourceAccountId&&
   iamProof.offsite?.accountId===p.offsiteAccountId&&
   iamProof.source?.exactRoleTrustAndInlinePolicyObserved===true&&
   iamProof.offsite?.exactRoleTrustAndInlinePolicyObserved===true&&
   iamProof.source?.effectivePermissionsProven===false&&
   iamProof.offsite?.effectivePermissionsProven===false&&
   iamProof.exactTwoRoleReadOnlyShapeMatched===true&&
   iamProof.effectiveIamRightsIndependentlyVerified===false&&
   iamProof.permissionsBoundaryPolicyContentInspected===false&&
   iamProof.productionAuthorized===false&&
   Number.isSafeInteger(iamProof.checkedAtMs)&&
   current>=iamProof.checkedAtMs&&current<=iamProof.expiresAtMs&&
   iamProof.expiresAtMs-iamProof.checkedAtMs===60000&&
   hex64.test(iamSha||'')&&iamSha===stableHash(iamRaw),
   'IAM role provenance, freshness or digest mismatched');
  const {evidenceSha256:drillSha,...drillRaw}=drillProof||{};
  ok(drillProof?.schemaVersion===1&&
   drillProof.scope==='disposable-postgres17-only'&&
   drillProof.sourceCommit===commit&&
   drillProof.sourceBundleSha256===bundleSha256&&
   drillProof.runId===w.runId&&
   drillProof.sequence===w.sequence&&drillProof.nonce===w.nonce&&
   drillProof.r181EvidenceSha256===w.r181EvidenceSha256&&
   drillProof.r180ClassificationSha256===w.r180ClassificationSha256&&
   drillProof.r180QuorumReceiptSha256===w.r180QuorumReceiptSha256&&
   Number.isSafeInteger(drillProof.measuredRestoreMs)&&
   drillProof.measuredRestoreMs>=1&&
   drillProof.measuredRestoreMs<=drillProof.configuredTestBudgetMs&&
   drillProof.observedFrozenSnapshotLossMs===0&&
   drillProof.twoIndependentNativePgReadbacks===true&&
   drillProof.sameNoGoAndRlsInIsolatedRestore===true&&
   drillProof.realProductionRpoRtoMeasured===false&&
   drillProof.productionAuthorized===false&&
   drillProof.decision==='NO_GO_PRODUCTION_RPO_RTO_NOT_MEASURED'&&
   hex64.test(drillSha||'')&&drillSha===sha(drillRaw),
   'test recovery duration or scope promoted to real production RPO/RTO');
  const after=await readR181Witness(),qAfter=await quarantine.status();
  ok(equal(w,after)&&qAfter?.closed===true&&
   qAfter.generation===q.generation,'high-water or quarantine changed');
  const evidence={
   schemaVersion:1,scope:'synthetic-provider-disposable-pg17-readiness',
   decision:'NO_GO_INDEPENDENT_ATTESTATION_PENDING',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:w.runId,sequence:w.sequence,nonce:w.nonce,
   r181EvidenceSha256:w.r181EvidenceSha256,
   r180ClassificationSha256:w.r180ClassificationSha256,
   r180QuorumReceiptSha256:w.r180QuorumReceiptSha256,
   iamEvidenceSha256:iamSha,recoveryDrillEvidenceSha256:drillSha,
   sourceAccountId:p.sourceAccountId,offsiteAccountId:p.offsiteAccountId,
   isolatedMeasuredRestoreMs:drillProof.measuredRestoreMs,
   isolatedObservedSnapshotLossMs:0,
   realIamPermissionBoundaryIndependentlyAttested:false,
   actualGithubHumanApprovalsIndependentlyAttested:false,
   realProductionRpoRtoVerified:false,
   realS3DeliveryIndependentlyVerified:false,
   closedQuarantineVerified:true,
   productionAuthorized:false,observedAtMs:clock()
  };
  return Object.freeze({...evidence,evidenceSha256:sha(evidence)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,readOnly:true,productionAuthorized:false})});
}
