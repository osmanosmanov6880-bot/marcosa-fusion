/**
 * R164 operations audit: explicit six proofs, no implicit release authority.
 * This function has zero side effects and cannot authorize production.
 * CI-only evidence must never be upgraded to real staging approval.
 */
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fresh=(at,now,ttl)=>Number.isSafeInteger(at)&&at>0&&
 at<=now+10000&&now-at<=ttl;
export function evaluateR164OperationsAudit({
 commit,bundleSha256,target,quorum,restore,rollback,priorReleaseGate,
 now=Date.now()
}={}){
 const missing=[];
 const need=(yes,reason)=>{if(!yes)missing.push(reason);};
 const id=typeof commit==='string'&&H40.test(commit)&&
  typeof bundleSha256==='string'&&H64.test(bundleSha256);
 need(id,'source_identity');
 need(target&&H64.test(target.digest||'')&&target.commit===commit&&
  target.bundleSha256===bundleSha256&&
  target.productionAuthorized===false&&target.externalDeploymentVerified===false,
  'immutable_staging_target');
 need(quorum&&quorum.signatureCount===2&&quorum.distinctPinnedKeys===true&&
  quorum.targetDigest===target?.digest&&quorum.commit===commit&&
  quorum.productionAuthorized===false&&
  quorum.expiry>=now&&quorum.expiry<=now+300000,
  'two_pinned_ephemeral_reviewer_keys');
 need(restore&&restore.passed===true&&restore.commit===commit&&
  restore.bundleSha256===bundleSha256&&
  restore.productionAuthorized===false&&
  restore.independentRestoreDatabase===true&&
  restore.encryptedOffsiteCopyVerified===false&&
  fresh(restore.observedAtMs,now,180000),
  'fresh_real_pg17_isolated_restore');
 need(rollback&&rollback.shutdownVerified===true&&
  rollback.mutationReady===false&&rollback.phase==='stopped'&&
  rollback.productionAuthorized===false,
  'verified_emergency_drain');
 need(priorReleaseGate&&
  ['CI_SIMULATION_COMPLETE','READY_FOR_INDEPENDENT_STAGING_AUDIT']
   .includes(priorReleaseGate.decision)&&
  priorReleaseGate.commit===commit&&
  priorReleaseGate.productionAuthorized===false&&
  priorReleaseGate.manualOperatorReviewRequired===true,
  'prior_R163_reproducible_release_checks');
 const synthetic=target?.synthetic!==false||quorum?.synthetic!==false||
  restore?.scope!=='independent-staging'||priorReleaseGate?.syntheticEvidence!==false;
 const decision=missing.length?'BLOCKED':synthetic?'CI_REHEARSAL_COMPLETE':
  'READY_FOR_INDEPENDENT_HUMAN_STAGING_REVIEW';
 return Object.freeze({schemaVersion:1,commit:id?commit:null,
  decision,missing,passingProofs:6-missing.length,requiredProofs:6,
  syntheticEvidence:synthetic,productionAuthorized:false,
  externalDeploymentAllowed:false,liveSupabaseVerified:false,
  externalBackupVerified:false,humanIdentityVerified:false,
  paymentsEnabled:false,payoutsEnabled:false,
  mustApproveManually:true});
}
