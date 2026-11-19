/**
 * R165: compare independently queried source and restored PG17 security state.
 * Only synthetic off-process recovery proof; not hosted/offsite production DR.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/;
const H64=/^[a-f0-9]{64}$/;
const KEYS=['nonceCount','quarantineClosed','quarantineGeneration',
 'creatorRevision','commandCount','inboxRows','inboxAcknowledgements',
 'revokedSessions','activeSessions','nonceRls','quarantineRls',
 'browserCanReadNonce','browserCanReadQuarantine','writerCanOpenGate'].sort();
const fail=msg=>{throw Error('R165 recovery: '+msg);};
const check=(v,msg)=>{if(!v)fail(msg);};
function inventory(x){
 check(x&&Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).sort().join(',')===KEYS.join(','),
  'exact bounded non-PII PostgreSQL inventory required');
 for(const k of ['nonceCount','quarantineGeneration','creatorRevision','commandCount',
  'inboxRows','inboxAcknowledgements','revokedSessions','activeSessions'])
  check(Number.isSafeInteger(x[k])&&x[k]>=0&&x[k]<=10000000,
   'nonnegative safe numeric invariant required');
 for(const k of ['quarantineClosed','nonceRls','quarantineRls','browserCanReadNonce',
  'browserCanReadQuarantine','writerCanOpenGate'])
  check(typeof x[k]==='boolean','strict boolean role evidence required');
 check(x.nonceCount===1&&x.quarantineClosed===true&&x.quarantineGeneration>=3&&
  x.creatorRevision===3&&x.commandCount===3&&x.inboxRows===1&&
  x.inboxAcknowledgements===2&&x.revokedSessions===0&&x.activeSessions===1&&
  x.nonceRls&&x.quarantineRls&&!x.browserCanReadNonce&&
  !x.browserCanReadQuarantine&&!x.writerCanOpenGate,
  'quarantine, durable nonce, RLS and creator invariants not satisfied');
}
export function verifyR165EncryptedRestore({
 commit,bundleSha256,encryptedSha256,source,restored,
 encryptedReadbackVerified,wrongKeyRejected,tamperingRejected,corruptArchiveRejected,
 sourceDatabase='postgres',restoredDatabase='marcosa_r165_restored',
 clock=()=>Date.now(),checkpointAtMs,finishedAtMs
}={}){
 check(H40.test(commit||'')&&H64.test(bundleSha256||'')&&H64.test(encryptedSha256||''),
  'full source and ciphertext SHA required');
 check(sourceDatabase==='postgres'&&restoredDatabase==='marcosa_r165_restored',
  'independent disposable restore database required');
 check(encryptedReadbackVerified===true&&wrongKeyRejected===true&&
  tamperingRejected===true&&corruptArchiveRejected===true,
  'all cryptographic negative checks required');
 check(Number.isSafeInteger(checkpointAtMs)&&Number.isSafeInteger(finishedAtMs)&&
  checkpointAtMs>0&&finishedAtMs>=checkpointAtMs&&
  finishedAtMs<=clock()+10000&&finishedAtMs-checkpointAtMs<=120000,
  'bounded, real measured restore window required');
 inventory(source);inventory(restored);
 const original=Buffer.from(JSON.stringify(source));
 const copy=Buffer.from(JSON.stringify(restored));
 check(original.length===copy.length&&timingSafeEqual(original,copy),
  'restored security inventory differs byte-for-byte');
 const digest=createHash('sha256').update(JSON.stringify({
  schemaVersion:1,commit,bundleSha256,encryptedSha256,
  sourceDatabase,restoredDatabase,source,restored,
  checkpointAtMs,finishedAtMs,encryptedReadbackVerified,
  wrongKeyRejected,tamperingRejected,corruptArchiveRejected,
  productionAuthorized:false,realOffsiteRestoreVerified:false
 })).digest('hex');
 return Object.freeze({verified:true,proofSha256:digest,encryptedSha256,
  observedRtoMs:finishedAtMs-checkpointAtMs,rollbackRehearsalOnly:true,
  nonceDurableInPostgres:true,quarantineRestoredClosed:true,
  encryptedBackupVerified:true,realOffsiteRestoreVerified:false,
  productionAuthorized:false,externalDeploymentAllowed:false});
}
