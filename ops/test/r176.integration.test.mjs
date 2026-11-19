import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {issueR175DualAnchor} from '../r175/dual-anchor.mjs';
import {verifyR176AnchorChain} from '../r176/chain-verifier.mjs';
import {createR176OffsiteChainReader} from '../r176/offsite-chain.mjs';
import {r176AdmissionSql,createR176RecoveryFence,createR176CompositeNonce}
 from '../r176/recovery-fence.mjs';
import {createR176RecoveryGuard} from '../r176/recovery-guard.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const op=generateKeyPairSync('ed25519'),rv=generateKeyPairSync('ed25519');
const clock=()=>1800000000000;
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const pins={pinnedOperatorSpkiSha256:'',pinnedReviewerSpkiSha256:''};
const info={sequence:1,commit,bundleSha256,archiveSha256:'c'.repeat(64),
 escrowSha256:'d'.repeat(64),checkpointSha256:'e'.repeat(64),
 priorAnchorSha256:'0'.repeat(64)};
const first=issueR175DualAnchor({data:info,operatorKey:op.privateKey,
 reviewerKey:rv.privateKey,clock});
pins.pinnedOperatorSpkiSha256=first.approvals[0].signerSpkiSha256;
pins.pinnedReviewerSpkiSha256=first.approvals[1].signerSpkiSha256;
const secondData={...info,sequence:2,archiveSha256:'f'.repeat(64),
 escrowSha256:'1'.repeat(64),checkpointSha256:'2'.repeat(64),
 priorAnchorSha256:first.anchorSha256};
const second=issueR175DualAnchor({data:secondData,operatorKey:op.privateKey,
 reviewerKey:rv.privateKey,clock});
const entries=[first,second].map((receipt,i)=>({
 receipt,sha256:sha(JSON.stringify(receipt)),versionId:'offsite-version-'+(i+1)
}));
const checkpoint={sequence:2,source_commit:commit,
 archive_sha256:secondData.archiveSha256,
 escrow_sha256:secondData.escrowSha256,
 evidence_sha256:secondData.checkpointSha256,
 production_authorized:false};
const opts={entries,checkpoint,bundleSha256,...pins,clock};
test('R176 authenticates full chronological dual-Ed25519 history',()=>{
 const result=verifyR176AnchorChain(opts);
 assert.equal(result.contiguousEntries,2);
 assert.equal(result.genesisVerified,true);
 assert.equal(result.realHumanApprovalVerified,false);
 assert.equal(result.productionAuthorized,false);
});
test('R176 denies missing genesis, swapped versions, malicious parent and stale R174 high-water',()=>{
 for(const patch of [
  {entries:[entries[1]]},
  {entries:[entries[1],entries[0]]},
  {checkpoint:{...checkpoint,sequence:3}},
  {checkpoint:{...checkpoint,evidence_sha256:'3'.repeat(64)}},
  {pinnedReviewerSpkiSha256:'4'.repeat(64)},
  {entries:[entries[0],{...entries[1],sha256:'5'.repeat(64)}]},
  {entries:[entries[0],{...entries[1],receipt:{...second,
   manifest:{...second.manifest,priorAnchorSha256:'6'.repeat(64)}}}]}
 ])assert.throws(()=>verifyR176AnchorChain({...opts,...patch}),/R176 anchor chain|R175 dual anchor/);
});
test('R176 offsite history reads exact S3 object versions, rejects changed response',async()=>{
 const locators=entries.map((e,i)=>({
  sha256:e.sha256,versionId:e.versionId,expected:i===0?info:secondData
 }));
 let calls=0;
 const reader=createR176OffsiteChainReader({
  anchorStore:{read:async x=>{calls++;const item=entries.find(e=>e.sha256===x.sha256);
   if(!item||item.versionId!==x.versionId)throw Error('bad version');
   return{...item,verified:true,productionAuthorized:false};}},
  ...pins,clock,allowRead:true
 });
 const result=await reader.read({locators,checkpoint,bundleSha256});
 assert.equal(result.verified,true);assert.equal(calls,2);
 await assert.rejects(reader.read({locators:[...locators].reverse(),
  checkpoint,bundleSha256}),/R176 anchor chain/);
 await assert.rejects(createR176OffsiteChainReader({
  anchorStore:{read:async()=>{throw Error('unavailable');}},...pins,clock
 }).read({locators,checkpoint,bundleSha256}),/disabled/);
});
const nonce='7'.repeat(32);
const input={nonce,sequence:2,anchorSha256:entries[1].sha256,
 archiveSha256:secondData.archiveSha256,
 checkpointSha256:secondData.checkpointSha256,commit};
test('R176 SQL double checks same immutable PG17 R175 lease and R174 source',()=>{
 const sql=r176AdmissionSql(input);
 assert.match(sql,/SERIALIZABLE/);
 assert.match(sql,/SET LOCAL ROLE marcosa_r176_writer/);
 assert.match(sql,/JOIN r174_ci.checkpoint/);
 assert.match(sql,/r175_ci.recovery_leases/);
 assert.match(sql,/ON CONFLICT DO NOTHING/);
 for(const patch of [{nonce:"' OR 1=1"},{sequence:0},{commit:'bad'},
  {checkpointSha256:'bad'}])
 assert.throws(()=>r176AdmissionSql({...input,...patch}),/R176 recovery fence/);
});
test('R176 deterministic PG reply rejects replay, failed second audit and outage',async()=>{
 let n=0;
 const f=createR176RecoveryFence({
  executeSql:async()=>n++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'
 });
 assert.equal((await f.admit(input)).admittedExactlyOnce,true);
 await assert.rejects(f.admit(input),/R176 recovery fence/);
 await assert.rejects(createR176RecoveryFence({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).admit(input),/R176 recovery fence/);
 await assert.rejects(createR176RecoveryFence({
  executeSql:async()=>{throw Error('lost');}
 }).admit(input),/atomic PostgreSQL/);
});
test('R176 composite lease never reports success when second fence denies',async()=>{
 const composite=createR176CompositeNonce({
  checkpointSha256:input.checkpointSha256,
  r175Nonce:{consume:async x=>({consumedExactlyOnce:true,
   nonce:x.nonce,anchorSha256:x.anchorSha256,productionAuthorized:false})},
  r176Fence:{admit:async()=>{throw Error('duplicate');}}
 });
 await assert.rejects(composite.consume(input),/duplicate/);
});
function guardFixture({badHistory=false,denyFence=false,moveHighWater=false}={}){
 let reads=0,n1=0,n2=0,restores=0;const incidents=[];
 const c={snapshot:()=>({stopped:true}),trip:async x=>{
  incidents.push(x);return{accepted:true};}};
 const reader={read:async()=>badHistory?{verified:false}:verifyR176AnchorChain(opts)};
 const guard=createR176RecoveryGuard({
  readCheckpoint:async()=>{reads++;return moveHighWater&&reads>1?
   {...checkpoint,sequence:3}:checkpoint;},
  chainReader:reader,
  anchorStore:{read:async()=>({verified:true,
   sha256:entries[1].sha256,versionId:entries[1].versionId,
   receipt:second})},
  r175Nonce:{consume:async x=>{n1++;return{
   consumedExactlyOnce:true,nonce:x.nonce,
   anchorSha256:x.anchorSha256,productionAuthorized:false};}},
  r176Fence:{admit:async x=>{n2++;if(denyFence)throw Error('replay');
   return{admittedExactlyOnce:true,nonce:x.nonce,sequence:x.sequence,
    productionAuthorized:false};}},
  offsiteRehearsal:async()=>{restores++;return{
   verified:true,sourceS3AndKmsNotAccessedDuringRestore:true,
   syntheticRowsLost:0,productionAuthorized:false};},
  emergencyCircuit:c,clock,allowRecovery:true
 });
 return{guard,counts:()=>({reads,n1,n2,restores,incidents})};
}
const args={locators:[],bundleSha256,nonce,...pins};
test('R176 guard verifies all historical anchors before nonce and isolated recovery',async()=>{
 const f=guardFixture(),result=await f.guard.rehearse(args);
 assert.equal(result.verified,true);
 assert.equal(result.sequenceFenceVerified,true);
 assert.equal(result.productionAuthorized,false);
 assert.deepEqual(f.counts(),{reads:5,n1:1,n2:1,restores:1,incidents:[]});
});
test('R176 denies incomplete history, PG fence replay, and checkpoint race',async()=>{
 for(const patch of [{badHistory:true},{denyFence:true},{moveHighWater:true}]){
  const f=guardFixture(patch);
  await assert.rejects(f.guard.rehearse(args),/R176 recovery guard/);
  const result=f.counts();
  assert.equal(result.restores,0);
  assert.equal(result.incidents.length,1);
  if(patch.badHistory||patch.moveHighWater){
   assert.equal(result.n1,0);assert.equal(result.n2,0);
  }else assert.equal(result.n2,1);
 }
});
