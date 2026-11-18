/**
 * R164 constrained disaster-recovery witness.
 * Verifies measured synthetic Postgres restore invariants and backup digest.
 * Never equates successful CI restore with a real Supabase/offsite DR approval.
 */
import {timingSafeEqual,createHash} from 'node:crypto';
const H40=/^[0-9a-f]{40}$/,H64=/^[0-9a-f]{64}$/;
const flags=['seasonRevision','commandCount','inboxRows','inboxAcknowledgements',
 'revokedSessions','activeSessions','sessionRls','inboxRls',
 'browserCanReadSessions','browserCanReadInbox'];
const fail=m=>{throw Error('R164 restore: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
function checkProof(x){
 ok(x&&Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).sort().join(',')===flags.slice().sort().join(','),
  'exact non-PII SQL inventory required');
 for(const n of flags.slice(0,6))
  ok(Number.isSafeInteger(x[n])&&x[n]>=0&&x[n]<=100000,
   'bounded PostgreSQL row counts required');
 for(const b of flags.slice(6))ok(typeof x[b]==='boolean',
  'SQL role/RLS check must be boolean');
 ok(x.seasonRevision===2&&x.commandCount===2&&x.inboxRows===1&&
  x.inboxAcknowledgements===2&&x.revokedSessions===0&&
  x.activeSessions===1&&x.sessionRls===true&&x.inboxRls===true&&
  x.browserCanReadSessions===false&&x.browserCanReadInbox===false,
  'RLS/session/idempotency invariant failed');
}
export function createR164RestoreWitness({
 commit,bundleSha256,archiveSha256,sourceDb,restoreDb,
 source,restored,checkpointAtMs,restoredAtMs,
 corruptBackupRejected,scope='synthetic-ci',clock=()=>Date.now()
}={}){
 ok(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  H64.test(archiveSha256||''),'pinned commit, source bundle and archive digest');
 ok(sourceDb==='postgres'&&restoreDb==='marcosa_r164_restored'&&
  sourceDb!==restoreDb&&scope==='synthetic-ci',
  'only independent disposable database names supported');
 ok(typeof clock==='function'&&Number.isSafeInteger(checkpointAtMs)&&
  Number.isSafeInteger(restoredAtMs)&&checkpointAtMs>0&&
  restoredAtMs>=checkpointAtMs&&restoredAtMs<=clock()+10000&&
  restoredAtMs-checkpointAtMs<=120000,'measured recovery window required');
 ok(corruptBackupRejected===true,'corrupt archive rejection must be observed');
 checkProof(source);checkProof(restored);
 ok(JSON.stringify(source)===JSON.stringify(restored),
  'restored data differs from checked source row proof');
 const evidence={schemaVersion:1,commit,bundleSha256,archiveSha256,
  sourceDb,restoreDb,checkpointAtMs,restoredAtMs,
  rtoObservedMs:restoredAtMs-checkpointAtMs,scope,source,restored,
  corruptedArchiveRejected:true,productionAuthorized:false};
 const witnessDigest=createHash('sha256')
  .update(JSON.stringify(evidence)).digest('hex');
 return Object.freeze({commit,bundleSha256,archiveSha256,
  witnessDigest,passed:true,scope,rtoObservedMs:evidence.rtoObservedMs,
  observedAtMs:restoredAtMs,independentRestoreDatabase:true,
  encryptedOffsiteCopyVerified:false,realSupabaseVerified:false,
  productionAuthorized:false});
}
export function verifyR164RestoreWitness(proof,{commit,bundleSha256,
 witnessDigest,now=Date.now(),maxAgeMs=180000}={}){
 ok(proof&&proof.passed===true&&proof.scope==='synthetic-ci'&&
  proof.commit===commit&&proof.bundleSha256===bundleSha256&&
  proof.productionAuthorized===false&&proof.realSupabaseVerified===false&&
  proof.independentRestoreDatabase===true,
  'only verified, synthetic same-commit restore accepted');
 ok(H64.test(witnessDigest||'')&&proof.witnessDigest===witnessDigest,
  'restore digest mismatch');
 ok(Number.isSafeInteger(proof.observedAtMs)&&proof.observedAtMs<=now+10000&&
  now-proof.observedAtMs<=maxAgeMs&&
  Number.isInteger(proof.rtoObservedMs)&&proof.rtoObservedMs<=120000,
  'stale recovery proof or excessive RTO');
 return Object.freeze({matched:true,scope:'synthetic-ci',
  observedRtoMs:proof.rtoObservedMs,productionAuthorized:false,
  actualHostedRestoreVerified:false});
}
