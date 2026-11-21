import test from 'node:test';
import assert from 'node:assert/strict';
import {createR177RecoveryController}
 from '../r177/recovery-controller.mjs';
const nonce='a'.repeat(32),root='b'.repeat(64);
const commit='c'.repeat(40),archive='d'.repeat(64),
 checkpointSha='e'.repeat(64),object='f'.repeat(64),
 restored='1'.repeat(64);
const current={sequence:2,source_commit:commit,
 archive_sha256:archive,evidence_sha256:checkpointSha,
 escrow_sha256:'2'.repeat(64),production_authorized:false};
const locators=[{sha256:'3'.repeat(64)},{sha256:object}];
function fixture({badHistory=false,admissionDenied=false,
 noPrivacy=false,outcomeDenied=false,moveCheckpoint=false,
 noReadback=false}={}){
 let reads=0,admissions=0,restores=0,recorded=0;
 const incidents=[];
 const circuit={snapshot:()=>({stopped:true}),trip:async x=>{
  incidents.push(x);return{accepted:true};}};
 const guard=createR177RecoveryController({
  readCheckpoint:async()=>{reads++;
   return moveCheckpoint&&reads>1?{...current,sequence:3}:current;},
  reconciler:{reconcile:async()=>badHistory?{verified:false}:{
   verified:true,sequence:2,anchorCount:2,rootSha256:root,
   latestObjectSha256:object,productionAuthorized:false}},
  r176Guard:{rehearse:async()=>{admissions++;if(admissionDenied)
   throw Error('R176 refused');restores++;return{
    verified:true,sequenceFenceVerified:true,nonceCommitted:true,
    productionAuthorized:false};}},
  readRestoredEvidence:async()=>noReadback?null:{
   nativePg17RestoreVerified:true,privacyRlsVerified:!noPrivacy,
   replayDeniedAfterRestore:true,syntheticDataOnly:true,
   productionAuthorized:false,nonce,sequence:2,
   restoredStateSha256:restored},
  outcomeStore:{record:async x=>{recorded++;if(outcomeDenied)
   throw Error('PostgreSQL unavailable');return{recorded:true,
    ...x,productionAuthorized:false};}},
  readOutcome:async()=>noReadback?null:{
   nonce,sequence:2,rootSha256:root,
   restoredStateSha256:restored,productionAuthorized:false},
  emergencyCircuit:circuit,allowRecovery:true
 });
 return{guard,events:()=>({reads,admissions,restores,recorded,
  incidentCount:incidents.length})};
}
const args={locators,bundleSha256:'4'.repeat(64),nonce,
 pinnedOperatorSpkiSha256:'5'.repeat(64),
 pinnedReviewerSpkiSha256:'6'.repeat(64)};
test('R177 reports complete recovery only after durable restored PG17 proof',async()=>{
 const f=fixture(),result=await f.guard.rehearse(args);
 assert.equal(result.verified,true);
 assert.equal(result.immutablePostRestoreOutcomeVerified,true);
 assert.equal(result.productionAuthorized,false);
 assert.equal(f.events().recorded,1);
 assert.equal(f.events().incidentCount,0);
});
test('R177 prevents success on unsigned history, checkpoint race, failed R176 gate, privacy and evidence outage',async()=>{
 for(const bad of [{badHistory:true},{moveCheckpoint:true},
  {admissionDenied:true},{noPrivacy:true},{outcomeDenied:true},
  {noReadback:true}]){
  const f=fixture(bad);
  await assert.rejects(f.guard.rehearse(args),
   /R177 recovery controller/);
  assert.equal(f.events().incidentCount,1);
  if(bad.badHistory||bad.moveCheckpoint)
   assert.equal(f.events().admissions,0);
  if(bad.noPrivacy)assert.equal(f.events().recorded,0);
 }
});
