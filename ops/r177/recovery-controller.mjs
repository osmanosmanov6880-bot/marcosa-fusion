/**
 * R177: fail-closed complete recovery verification and append-only outcome.
 * Actual restored target state MUST be examined by injected independent
 * PostgreSQL verifier; user-supplied boolean is not sufficient.
 */
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R177 recovery controller: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function createR177RecoveryController({reconciler,
 r176Guard,readCheckpoint,readRestoredEvidence,outcomeStore,
 readOutcome,emergencyCircuit,allowRecovery=false}={}){
 ok(reconciler&&typeof reconciler.reconcile==='function'&&
  r176Guard&&typeof r176Guard.rehearse==='function'&&
  typeof readCheckpoint==='function'&&
  typeof readRestoredEvidence==='function'&&
  outcomeStore&&typeof outcomeStore.record==='function'&&
  typeof readOutcome==='function'&&
  emergencyCircuit&&typeof emergencyCircuit.trip==='function'&&
  typeof emergencyCircuit.snapshot==='function',
  'independent restored-database verifier and immutable stores required');
 async function rehearse({locators,bundleSha256,nonce,
  pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,recoveryArgs}={}){
  ok(allowRecovery===true&&emergencyCircuit.snapshot().stopped===true,
   'isolated operator consent and stopped incident circuit required');
  let checkpoint;
  try{
   checkpoint=await readCheckpoint();
   const history=await reconciler.reconcile({locators,bundleSha256,
    pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256});
   ok(history?.verified===true&&history.sequence===checkpoint.sequence&&
    history.anchorCount===checkpoint.sequence&&
    H64.test(history.rootSha256||'')&&
    history.latestObjectSha256===locators.at(-1)?.sha256&&
    history.productionAuthorized===false,
    'offsite signed history not bound to current PostgreSQL tip');
   const middle=await readCheckpoint();
   ok(middle?.sequence===checkpoint.sequence&&
    middle?.evidence_sha256===checkpoint.evidence_sha256&&
    middle?.archive_sha256===checkpoint.archive_sha256,
    'source PostgreSQL checkpoint moved before R176 restore');
   const admitted=await r176Guard.rehearse({
    locators,bundleSha256,nonce,pinnedOperatorSpkiSha256,
    pinnedReviewerSpkiSha256,recoveryArgs
   });
   ok(admitted?.verified===true&&admitted.sequenceFenceVerified===true&&
    admitted.nonceCommitted===true&&admitted.productionAuthorized===false,
    'R176 durable one-use dual fence and isolated restore failed');
   const observed=await readRestoredEvidence({
    nonce,sequence:checkpoint.sequence,commit:checkpoint.source_commit,
    archiveSha256:checkpoint.archive_sha256,
    expectedCheckpointSha256:checkpoint.evidence_sha256
   });
   ok(observed?.nativePg17RestoreVerified===true&&
    observed.privacyRlsVerified===true&&
    observed.replayDeniedAfterRestore===true&&
    observed.syntheticDataOnly===true&&
    observed.productionAuthorized===false&&
    observed.nonce===nonce&&observed.sequence===checkpoint.sequence&&
    H64.test(observed.restoredStateSha256||''),
    'native restored database audit/replay/privacy evidence missing');
   const after=await readCheckpoint();
   ok(after?.sequence===checkpoint.sequence&&
    after?.archive_sha256===checkpoint.archive_sha256&&
    after?.evidence_sha256===checkpoint.evidence_sha256,
    'source high-water changed after restoring target');
   const outcome={
    nonce,sequence:checkpoint.sequence,rootSha256:history.rootSha256,
    restoredStateSha256:observed.restoredStateSha256,
    archiveSha256:checkpoint.archive_sha256,
    checkpointSha256:checkpoint.evidence_sha256,
    objectSha256:history.latestObjectSha256,
    sourceCommit:checkpoint.source_commit
   };
   const written=await outcomeStore.record(outcome);
   ok(written?.recorded===true&&
    written.restoredStateSha256===outcome.restoredStateSha256&&
    written.sequence===outcome.sequence&&written.nonce===outcome.nonce&&
    written.productionAuthorized===false,
    'immutable native PostgreSQL post-restore outcome rejected');
   const persisted=await readOutcome({nonce});
   ok(persisted?.nonce===nonce&&persisted.sequence===outcome.sequence&&
    persisted.rootSha256===outcome.rootSha256&&
    persisted.restoredStateSha256===outcome.restoredStateSha256&&
    persisted.productionAuthorized===false,
    'post-restore evidence not independently reread from PostgreSQL');
   return Object.freeze({verified:true,
    sequence:outcome.sequence,rootSha256:outcome.rootSha256,
    restoredStateSha256:outcome.restoredStateSha256,
    immutablePostRestoreOutcomeVerified:true,
    realAwsAccountsUsed:false,realHumansVerified:false,
    productionAuthorized:false});
  }catch{
   try{await emergencyCircuit.trip({type:'PG_RESTORE_FAILED',
    reason:'R177_RECOVERY_DENIED',
    commit:H40.test(checkpoint?.source_commit||'')?
     checkpoint.source_commit:'0'.repeat(40),
    archiveSha256:H64.test(checkpoint?.archive_sha256||'')?
     checkpoint.archive_sha256:'0'.repeat(64)
   });}catch{fail('restore failed and incident audit unavailable');}
   fail('no recovery success without restored PG17 witness and durable outcome');
  }
 }
 return Object.freeze({rehearse,publicStatus:()=>({
  allowed:allowRecovery,productionAuthorized:false})});
}
