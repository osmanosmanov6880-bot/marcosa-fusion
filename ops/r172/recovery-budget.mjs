/**
 * R172 measured disposable PG17 recovery and replay-fence exercise.
 * Measures recovery *time* in a static synthetic fixture, and observes
 * zero lost fixture rows. It cannot establish real customer RPO/RTO.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {verifyR167RestoredInventory} from '../r167/transfer-manifest.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R172 recovery budget: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const stable=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isCounts=c=>c&&Object.getPrototypeOf(c)===Object.prototype&&
 Number.isSafeInteger(c.runs)&&c.runs===1&&
 Number.isSafeInteger(c.audit)&&c.audit===1;
export function createR172RecoveryBudget({
 getInventory,readNonceCounts,backupAndSeal,restoreIntoDisposablePg,
 verifyReplayDenied,quarantine,
 monotonicClock=()=>performance.now(),wallClock=()=>Date.now(),
 maxRestoreMs=120000
}={}){
 ok([getInventory,readNonceCounts,backupAndSeal,restoreIntoDisposablePg,
  verifyReplayDenied].every(x=>typeof x==='function')&&
  quarantine&&typeof quarantine.status==='function'&&
  typeof monotonicClock==='function'&&typeof wallClock==='function'&&
  Number.isSafeInteger(maxRestoreMs)&&maxRestoreMs>=1000&&
  maxRestoreMs<=300000,
  'isolated PostgreSQL callbacks and bounded RTO budget required');
 async function exercise({commit,bundleSha256,nonce}={}){
  ok(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
   H32.test(nonce||''),'exact signed checkout and prior nonce required');
  const beforeGate=await quarantine.status();
  ok(beforeGate?.closed===true&&Number.isSafeInteger(beforeGate.generation)&&
   beforeGate.generation>=5,'SQL quarantine not closed');
  const sourceInventory=await getInventory({database:'postgres'});
  verifyR167RestoredInventory({source:sourceInventory,restored:sourceInventory});
  const sourceFence=await readNonceCounts({database:'postgres'});
  ok(isCounts(sourceFence),'one unique source nonce and one matching audit row');
  const sealed=await backupAndSeal({commit,bundleSha256,sourceInventory});
  const ref=sealed?.reference;
  ok(sealed?.remoteReceiptVerified===true&&
   ref&&ref.commit===commit&&ref.bundleSha256===bundleSha256&&
   H64.test(ref.encryptedSha256||'')&&
   H64.test(ref.inventorySha256||'')&&
   ref.productionAuthorized===false,
   'full encrypted source-bound archive receipt required');
  // Detect writes between source inventory and snapshot.
  const afterBackupInventory=await getInventory({database:'postgres'});
  const frozen=verifyR167RestoredInventory({
   source:sourceInventory,restored:afterBackupInventory
  });
  ok(frozen?.verified===true&&frozen.rlsPreserved===true,
   'source changed while backup was being created');
  const sourceFenceAgain=await readNonceCounts({database:'postgres'});
  ok(isCounts(sourceFenceAgain),'source nonce or immutable audit changed');
  const start=monotonicClock();
  ok(Number.isFinite(start)&&start>=0,'monotonic recovery clock invalid');
  let restoreResult;
  try{
   restoreResult=await restoreIntoDisposablePg({
    reference:ref,sourceInventory,
    pinnedInventorySha256:ref.inventorySha256,
    targetDatabase:'marcosa_r168_restored',
    productionAuthorized:false
   });
  }catch{fail('isolated PostgreSQL restore rejected');}
  ok(restoreResult?.verified===true&&
   restoreResult.database==='marcosa_r168_restored'&&
   restoreResult.productionAuthorized===false,
   'recovery result not independently verified');
  const restoredInventory=await getInventory({
   database:'marcosa_r168_restored'
  });
  const parity=verifyR167RestoredInventory({
   source:sourceInventory,restored:restoredInventory
  });
  ok(parity?.verified===true&&parity.rlsPreserved===true,
   'restored PG17 RLS, sessions or rows differ');
  const nonceCounts=await readNonceCounts({
   database:'marcosa_r168_restored'
  });
  ok(isCounts(nonceCounts),'restored PostgreSQL nonce/audit not identical');
  const replay=await verifyReplayDenied({
   database:'marcosa_r168_restored',nonce,commit,
   bundleSha256,productionAuthorized:false
  });
  ok(replay?.denied===true&&replay?.rowCount===1&&
   replay?.auditCount===1,
   'restored PG17 accepted a duplicate nonce or lost audit');
  const stop=monotonicClock();
  const rtoMs=Math.ceil(stop-start);
  ok(Number.isSafeInteger(rtoMs)&&rtoMs>=0&&
   rtoMs<=maxRestoreMs,
   'measured recovery exceeded disposable test RTO budget');
  const afterGate=await quarantine.status();
  ok(afterGate?.closed===true&&
   afterGate.generation===beforeGate.generation,
   'source quarantine changed during recovery');
  const now=wallClock();
  ok(Number.isSafeInteger(now)&&now>0,'timestamp required');
  const manifest={
   schemaVersion:1,commit,bundleSha256,
   archiveSha256:ref.encryptedSha256,sourceInventorySha256:ref.inventorySha256,
   nonce,restoreDatabase:'marcosa_r168_restored',
   observedSyntheticRtoMs:rtoMs,syntheticRowsLost:0,
   productionAuthorized:false
  };
  return Object.freeze({
   ...manifest,manifestSha256:stable(manifest),
   complete:true,sourceQuarantineUnchanged:true,
   restoredRlsAndSessionParity:true,duplicateNonceDeniedAfterRestore:true,
   actualProductionRtoProven:false,
   actualProductionRpoProven:false,
   separateAwsOffsiteReplicaUsed:false,
   reviewedAtMs:now
  });
 }
 return Object.freeze({exercise,publicStatus:()=>Object.freeze({
  syntheticStaticRowsOnly:true,productionAuthorized:false
 })});
}
