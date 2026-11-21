import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyR165EncryptedRestore} from '../r165/recovery-verifier.mjs';
const inv=()=>({nonceCount:1,quarantineClosed:true,quarantineGeneration:3,
 creatorRevision:3,commandCount:3,inboxRows:1,inboxAcknowledgements:2,
 revokedSessions:0,activeSessions:1,nonceRls:true,quarantineRls:true,
 browserCanReadNonce:false,browserCanReadQuarantine:false,writerCanOpenGate:false});
const data=()=>({commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),
 encryptedSha256:'c'.repeat(64),source:inv(),restored:inv(),
 encryptedReadbackVerified:true,wrongKeyRejected:true,tamperingRejected:true,
 corruptArchiveRejected:true,checkpointAtMs:1800000000000,
 finishedAtMs:1800000000500,clock:()=>1800000001000});
test('R165 durable nonce, closed quarantine and encrypted restore proof cannot grant production',()=>{
 const out=verifyR165EncryptedRestore(data());
 assert.equal(out.verified,true);
 assert.equal(out.observedRtoMs,500);
 assert.equal(out.productionAuthorized,false);
 assert.equal(out.realOffsiteRestoreVerified,false);
 assert.equal(out.nonceDurableInPostgres,true);
});
test('R165 restore rejects reopened gate, missing nonce, unauthorized browser roles or unequal inventories',()=>{
 for(const mutate of [
  d=>{d.restored.quarantineClosed=false;},
  d=>{d.restored.nonceCount=0;},
  d=>{d.restored.browserCanReadNonce=true;},
  d=>{d.restored.commandCount=2;},
  d=>{d.restored.inboxRows=2;},
  d=>{d.restored.quarantineGeneration=4;}
 ]){
  const d=data();mutate(d);
  assert.throws(()=>verifyR165EncryptedRestore(d),/R165 recovery/);
 }
});
test('R165 encrypted recovery rejects missing key/damage proof, stale timestamps and remote targets',()=>{
 for(const mutate of [
  d=>{d.wrongKeyRejected=false;},
  d=>{d.tamperingRejected=false;},
  d=>{d.corruptArchiveRejected=false;},
  d=>{d.restoredDatabase='production';},
  d=>{d.finishedAtMs=d.checkpointAtMs+200000;},
  d=>{d.commit='invalid';}
 ]){
  const d=data();mutate(d);
  assert.throws(()=>verifyR165EncryptedRestore(d),/R165 recovery/);
 }
});
