import test from 'node:test';
import assert from 'node:assert/strict';
import {createR164RestoreWitness,verifyR164RestoreWitness} from '../r164/restore-witness.mjs';
const NOW=1800000000000;
const state=()=>({seasonRevision:2,commandCount:2,inboxRows:1,
 inboxAcknowledgements:2,revokedSessions:0,activeSessions:1,
 sessionRls:true,inboxRls:true,browserCanReadSessions:false,
 browserCanReadInbox:false});
const fixture=()=>({commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),
 archiveSha256:'c'.repeat(64),sourceDb:'postgres',
 restoreDb:'marcosa_r164_restored',source:state(),restored:state(),
 checkpointAtMs:NOW-15000,restoredAtMs:NOW-1000,
 corruptBackupRejected:true,clock:()=>NOW});
test('R164 measured independent PG17 fixture restore checks RLS, revoked sessions and dedupe',()=>{
 const q=fixture(),w=createR164RestoreWitness(q);
 assert.equal(w.passed,true);assert.equal(w.rtoObservedMs,14000);
 assert.equal(w.productionAuthorized,false);
 assert.equal(w.encryptedOffsiteCopyVerified,false);
 assert.equal(verifyR164RestoreWitness(w,{commit:q.commit,bundleSha256:q.bundleSha256,
  witnessDigest:w.witnessDigest,now:NOW}).matched,true);
});
test('R164 resurrection, drift, missing corruption proof, fake independent backup rejected',()=>{
 for(const modified of [
  {restored:{...state(),revokedSessions:1}},
  {source:{...state(),browserCanReadInbox:true}},
  {corruptBackupRejected:false},
  {restoreDb:'postgres'},
  {restoredAtMs:NOW+130000},
  {scope:'production'},
  {archiveSha256:'notsha'}
 ])
  assert.throws(()=>createR164RestoreWitness({...fixture(),...modified}),/R164 restore/);
});
test('R164 stale proof and forged archive digest rejected',()=>{
 const q=fixture(),w=createR164RestoreWitness(q);
 assert.throws(()=>verifyR164RestoreWitness(w,{commit:q.commit,
  bundleSha256:q.bundleSha256,witnessDigest:'f'.repeat(64),now:NOW}),/digest mismatch/);
 assert.throws(()=>verifyR164RestoreWitness(w,{commit:q.commit,
  bundleSha256:q.bundleSha256,witnessDigest:w.witnessDigest,now:NOW+400000}),
  /stale recovery/);
});
