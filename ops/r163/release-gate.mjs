/**
 * R163 closed-by-default combined staging review decision. No mutation,
 * signing, approval or deploy operations are performed by this module.
 * A CI-only synthetic simulation can never become a live staging approval.
 */
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const hex40=/^[a-f0-9]{40}$/;
const hex64=/^[a-f0-9]{64}$/;
const check=(v)=>v===true;
const fresh=(v,now,ttl)=>Number.isSafeInteger(v)&&
 v<=now+30000&&v>=now-ttl;
const err=()=>({decision:'BLOCKED',productionAuthorized:false});
export function evaluateR163StagingCandidate({
 commit,bundleSha256,bundle,review,readback,slo,restore,
 now=Date.now()
}={}){
 const missing=[];
 const need=(yes,code)=>{if(!yes)missing.push(code);};
 need(typeof commit==='string'&&hex40.test(commit)&&
  typeof bundleSha256==='string'&&hex64.test(bundleSha256),
  'full_source_identity');
 need(bundle&&check(bundle.verifiedAgainstCheckout)&&
  check(bundle.exactSourceBytes)&&bundle.sha256===bundleSha256&&
  bundle.commit===commit&&bundle.productionAuthorized===false,
  'exact_build_source_provenance');
 need(review&&check(review.cryptographicSignatureVerified)&&
  check(review.reviewerKeyDistinctFromBuilder)&&
  review.commit===commit&&review.bundleSha256===bundleSha256&&
  review.productionAuthorized===false&&review.humanIndependenceEstablished===false&&
  Number.isSafeInteger(review.validUntilMs)&&
  review.validUntilMs>=now&&review.validUntilMs<=now+900000,
  'key_separated_offline_staging_review');
 need(readback&&check(readback.readbackMatched)&&
  readback.commit===commit&&readback.bundleSha256===bundleSha256&&
  readback.productionAuthorized===false&&
  fresh(readback.observedAtMs,now,300000),
  'pinned_staging_readback');
 need(slo&&check(slo.ready)&&
  Number.isInteger(slo.healthyWindows)&&slo.healthyWindows>=2&&
  slo.productionAuthorized===false&&
  fresh(slo.lastSampleAtMs,now,300000)&&
  fresh(slo.lastEvaluatedAtMs,now,300000),
  'nonoverlapping_recent_canary_slo');
 need(restore&&check(restore.passed)&&restore.commit===commit&&
  restore.bundleSha256===bundleSha256&&
  restore.productionAuthorized===false&&
  ['synthetic-ci','independent-staging'].includes(restore.scope)&&
  fresh(restore.observedAtMs,now,86400000),
  'matching_recent_restore_proof');
 const allPresent=missing.length===0;
 const synthetic=readback?.syntheticCiLoopback===true||
  readback?.pinnedTlsTransportUsed!==true||
  restore?.scope==='synthetic-ci';
 const decision=!allPresent?'BLOCKED':
  synthetic?'CI_SIMULATION_COMPLETE':'READY_FOR_INDEPENDENT_STAGING_AUDIT';
 return Object.freeze({
  schemaVersion:1,repository:REPO,commit:hex40.test(commit||'')?commit:null,
  decision,missing,
  evidenceChecksPassed:6-missing.length,requiredChecks:6,
  syntheticEvidence:synthetic,manualOperatorReviewRequired:true,
  independentHumanReviewEstablished:false,
  externalHostOwnershipEstablished:false,
  productionAuthorized:false,paymentsEnabled:false,payoutsEnabled:false,
  liveSupabaseVerified:false,
  caution: 'Evidence is descriptive and never authorizes deployment.'
 });
}
