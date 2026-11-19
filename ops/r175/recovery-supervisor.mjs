/**
 * R175 recovery supervisor: pinned external Ed25519 anchor must match exact
 * R174 high-water before a new R175 PostgreSQL lease is consumed. A second
 * checkpoint read is required immediately before isolated offsite recovery.
 * No automatic retry or production authority.
 */
import {verifyR175DualAnchor} from './dual-anchor.mjs';
const fail=m=>{throw Error('R175 recovery supervisor: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function createR175RecoverySupervisor({
 readCheckpoint,anchorStore,recoveryNonce,offsiteRehearsal,
 emergencyCircuit,clock=()=>Date.now(),allowRecovery=false
}={}){
 ok(typeof readCheckpoint==='function'&&
  anchorStore&&typeof anchorStore.read==='function'&&
  recoveryNonce&&typeof recoveryNonce.consume==='function'&&
  typeof offsiteRehearsal==='function'&&
  emergencyCircuit&&typeof emergencyCircuit.trip==='function'&&
  typeof emergencyCircuit.snapshot==='function'&&
  typeof clock==='function',
  'require independent checkpoint, durable lease, signed anchor and circuit');
 async function rehearse({anchorSha256,anchorVersionId,
  pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
  nonce,commit,bundleSha256,archiveSha256,escrowSha256,
  checkpointSha256,sequence,priorAnchorSha256,
  recoveryArgs}={}){
  ok(allowRecovery===true,'offsite recovery disabled by default');
  ok(emergencyCircuit.snapshot().stopped===true,
   'incident circuit must be fail-closed before recovery');
  const expected={commit,bundleSha256,archiveSha256,escrowSha256,
   checkpointSha256,sequence,priorAnchorSha256};
  let leaseConsumed=false;
  try{
   const before=await readCheckpoint();
   ok(before?.sequence===sequence&&before.source_commit===commit&&
    before.archive_sha256===archiveSha256&&
    before.escrow_sha256===escrowSha256&&
    before.evidence_sha256===checkpointSha256&&
    before.production_authorized===false,
    'checkpoint high-water mismatch');
   const anchor=await anchorStore.read({
    sha256:anchorSha256,versionId:anchorVersionId,expected});
   ok(anchor?.verified===true&&anchor.sha256===anchorSha256&&
    anchor.versionId===anchorVersionId,
    'immutable anchor read-back failed');
   const verified=verifyR175DualAnchor({
    receipt:anchor.receipt,pinnedOperatorSpkiSha256,
    pinnedReviewerSpkiSha256,...expected,clock});
   ok(verified.verified&&
    verified.realHumanApprovalVerified===false,
    'anchor signer or provenance incomplete');
   const beforeConsume=await readCheckpoint();
   ok(beforeConsume.sequence===before.sequence&&
    beforeConsume.evidence_sha256===before.evidence_sha256&&
    beforeConsume.archive_sha256===before.archive_sha256,
    'checkpoint changed during remote S3 read-back');
   const lease=await recoveryNonce.consume({
    nonce,sequence,anchorSha256,archiveSha256,commit
   });
   ok(lease?.consumedExactlyOnce===true&&
    lease.anchorSha256===anchorSha256&&
    lease.nonce===nonce&&lease.productionAuthorized===false,
    'durable restoration nonce was not committed');
   leaseConsumed=true;
   const immediate=await readCheckpoint();
   ok(immediate.sequence===sequence&&
    immediate.evidence_sha256===checkpointSha256,
    'high-water moved after durable nonce and before restore');
   const restored=await offsiteRehearsal({
    ...recoveryArgs,commit,bundleSha256,archiveSha256,
    escrowSha256,productionAuthorized:false
   });
   ok(restored?.verified===true&&
    restored.sourceS3AndKmsNotAccessedDuringRestore===true&&
    restored.syntheticRowsLost===0&&restored.productionAuthorized===false,
    'isolated offsite database restore not independently verified');
   return Object.freeze({verified:true,sequence,anchorSha256,
    nonceCommitted:true,sourceCloudIndependenceVerified:true,
    actualAwsAccountUsed:false,realHumanIdentityVerified:false,
    productionAuthorized:false});
  }catch{
   // Do not swallow audit/alert failure or return a successful receipt.
   try{await emergencyCircuit.trip({
    type:leaseConsumed?'PG_RESTORE_FAILED':'ARCHIVE_ROLLBACK',
    reason:'R175_RECOVERY_DENIED',commit,archiveSha256
   });}catch{fail('recovery failed and independent incident ledger unavailable');}
   fail('restore denied, nonce or signed anchor rejected');
  }
 }
 return Object.freeze({rehearse,publicStatus:()=>({
  allowed:allowRecovery,productionAuthorized:false
 })});
}
