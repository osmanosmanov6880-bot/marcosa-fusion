import test from 'node:test';
import assert from 'node:assert/strict';
import {createR172RecoveryBudget} from '../r172/recovery-budget.mjs';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 nonce='c'.repeat(32);
const inventory={auditHead:'a'.repeat(64),auditRows:3,
 publicRows:3,privateRows:2,activeSessions:1,revokedSessions:1,
 privateRls:true,publicRls:true,
 browserCanReadPrivate:false,readerCanReadPrivate:true,
 writerCanDeleteAudit:false,rowsDigest:'f'.repeat(64),
 quarantineClosed:true,quarantineGeneration:5};
function mock({slow=false,changedRows=false,badAudit=false,
 replayAllowed=false,weakArchive=false,openGate=false,
 failedRestore=false}={}){
 let tick=0;
 const r=createR172RecoveryBudget({
  getInventory:async({database})=>({
   ...inventory,...(changedRows&&database==='marcosa_r168_restored'?
    {publicRows:4}:{})}),
  readNonceCounts:async({database})=>({
   runs:1,audit:badAudit&&database==='marcosa_r168_restored'?0:1
  }),
  backupAndSeal:async({commit,bundleSha256})=>({
   remoteReceiptVerified:true,
   reference:{commit,bundleSha256,
    encryptedSha256:weakArchive?'nope':'d'.repeat(64),
    inventorySha256:'e'.repeat(64),productionAuthorized:false}
  }),
  restoreIntoDisposablePg:async()=>{
   if(failedRestore)throw Error('offline');
   return{verified:true,database:'marcosa_r168_restored',
    productionAuthorized:false};
  },
  verifyReplayDenied:async()=>({
   denied:!replayAllowed,rowCount:1,auditCount:1
  }),
  quarantine:{status:async()=>({closed:!openGate,generation:5})},
  monotonicClock:()=>{tick++;return slow?tick*60000:tick*200;},
  wallClock:()=>1800000000000,maxRestoreMs:1500
 });
 return r;
}
test('R172 measured static synthetic recovery returns source-bound receipt, verified parity and replay denial',async()=>{
 const proof=await mock().exercise({commit,bundleSha256,nonce});
 assert.equal(proof.complete,true);
 assert.equal(proof.observedSyntheticRtoMs,200);
 assert.equal(proof.syntheticRowsLost,0);
 assert.equal(proof.duplicateNonceDeniedAfterRestore,true);
 assert.equal(proof.manifestSha256.length,64);
 assert.equal(proof.actualProductionRtoProven,false);
 assert.equal(proof.actualProductionRpoProven,false);
 assert.equal(proof.productionAuthorized,false);
});
test('R172 rejects lost audit, unexpected rows, accepted nonce replay, RTO breach, open gate or invalid archive',async()=>{
 for(const opts of [
  {slow:true},{changedRows:true},{badAudit:true},
  {replayAllowed:true},{weakArchive:true},{openGate:true},
  {failedRestore:true}
 ])await assert.rejects(
  mock(opts).exercise({commit,bundleSha256,nonce}),
  /R172 recovery budget|R167/);
});
test('R172 rejects missing callbacks and injection-format source metadata',async()=>{
 assert.throws(()=>createR172RecoveryBudget({}),/R172 recovery budget/);
 await assert.rejects(mock().exercise({
  commit:"x' DROP TABLE",bundleSha256,nonce
 }),/R172 recovery budget/);
});
