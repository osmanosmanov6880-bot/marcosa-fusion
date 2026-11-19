import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {issueR175DualAnchor} from '../r175/dual-anchor.mjs';
import {verifyR176AnchorChain} from '../r176/chain-verifier.mjs';
import {r177AppendAnchorSql,r177FinalizeRootSql,
 createR177AnchorWitness} from '../r177/anchor-witness.mjs';
import {createR177OffsiteReconciler,r177HistoryDigest}
 from '../r177/offsite-reconcile.mjs';
import {r177RecordOutcomeSql,createR177RestoreOutcomeStore}
 from '../r177/restore-outcome.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const clock=()=>1800000000000;
const op=generateKeyPairSync('ed25519'),rev=generateKeyPairSync('ed25519');
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const pins={};
const raw=[
 {sequence:1,commit,bundleSha256,archiveSha256:'c'.repeat(64),
  escrowSha256:'d'.repeat(64),checkpointSha256:'e'.repeat(64),
  priorAnchorSha256:'0'.repeat(64)},
 {sequence:2,commit,bundleSha256,archiveSha256:'f'.repeat(64),
  escrowSha256:'1'.repeat(64),checkpointSha256:'2'.repeat(64)}
];
const receipts=[];
for(let i=0;i<2;i++){
 if(i)raw[i].priorAnchorSha256=receipts[i-1].anchorSha256;
 receipts.push(issueR175DualAnchor({data:raw[i],
  operatorKey:op.privateKey,reviewerKey:rev.privateKey,clock}));
}
pins.pinnedOperatorSpkiSha256=receipts[0].approvals[0].signerSpkiSha256;
pins.pinnedReviewerSpkiSha256=receipts[0].approvals[1].signerSpkiSha256;
const locators=receipts.map((receipt,i)=>({
 sha256:sha(JSON.stringify(receipt)),versionId:'r177-version-'+(i+1),
 expected:raw[i]
}));
const checkpoint={sequence:2,source_commit:commit,
 archive_sha256:raw[1].archiveSha256,escrow_sha256:raw[1].escrowSha256,
 evidence_sha256:raw[1].checkpointSha256,production_authorized:false};
const rows=locators.map((item,i)=>({
 sequence:i+1,sourceCommit:commit,
 archiveSha256:raw[i].archiveSha256,
 checkpointSha256:raw[i].checkpointSha256,
 anchorSha256:receipts[i].anchorSha256,
 objectSha256:item.sha256,versionId:item.versionId,
 priorAnchorSha256:raw[i].priorAnchorSha256
}));
test('R177 SQL checks actual R174 events, parent and SERIALIZABLE atomic audit',()=>{
 const s=r177AppendAnchorSql(rows[1]);
 assert.match(s,/r174_ci.checkpoint_events/);
 assert.match(s,/r177_ci.anchors p/);
 assert.match(s,/ISOLATION LEVEL SERIALIZABLE/);
 assert.match(s,/SET LOCAL ROLE marcosa_r177_writer/);
 assert.match(s,/ON CONFLICT DO NOTHING/);
 for(const bad of [{sequence:0},{objectSha256:"' UNION SELECT"},
  {priorAnchorSha256:'bad'},{versionId:'bad/path'}])
 assert.throws(()=>r177AppendAnchorSql({...rows[1],...bad}),
  /R177 anchor witness/);
 assert.match(r177FinalizeRootSql({sequence:2,
  rootSha256:r177HistoryDigest(rows),latestObjectSha256:rows[1].objectSha256,
  checkpointSha256:rows[1].checkpointSha256}),/count\(\*\) FROM r177_ci.anchor_audit/);
});
test('R177 historical SHA-256 root refuses missing parent, reordering and altered byte identity',()=>{
 const root=r177HistoryDigest(rows);
 assert.match(root,/^[a-f0-9]{64}$/);
 for(const changed of [
  rows.slice(1),[rows[1],rows[0]],
  [rows[0],{...rows[1],priorAnchorSha256:'3'.repeat(64)}],
  [rows[0],{...rows[1],objectSha256:'wrong'}]
 ])assert.throws(()=>r177HistoryDigest(changed),/R177 offsite reconciliation/);
 assert.notEqual(root,r177HistoryDigest([rows[0],{...rows[1],
  objectSha256:'4'.repeat(64)}]));
});
test('R177 atomic SQL writer denies missing/incomplete audit and replay',async()=>{
 const good=createR177AnchorWitness({executeSql:async()=> 'BEGIN\n1|1\nCOMMIT'});
 assert.equal((await good.append(rows[0])).recorded,true);
 const bad=createR177AnchorWitness({executeSql:async()=> 'BEGIN\n0|0\nCOMMIT'});
 await assert.rejects(bad.append(rows[0]),/R177 anchor witness/);
 await assert.rejects(bad.finalize({sequence:2,
  rootSha256:'a'.repeat(64),latestObjectSha256:'b'.repeat(64),
  checkpointSha256:'c'.repeat(64)}),/R177 anchor witness/);
});
function fixture({badHistory=false,highwaterMoves=false,
 extraRow=false,failInsert=false}={}){
 let reads=0;const saved=[],incidents=[];
 const witnessStore={
  append:async row=>{
   if(failInsert)throw Error('PostgreSQL outage');
   saved.push({...row});return{recorded:true,sequence:row.sequence,
    anchorSha256:row.anchorSha256,productionAuthorized:false};
  },
  finalize:async x=>({finalized:true,rootSha256:x.rootSha256,
   productionAuthorized:false})
 };
 const readCheckpoint=async()=>{
  reads++;
  return highwaterMoves&&reads>1?{...checkpoint,sequence:3}:checkpoint;
 };
 const chainReader={read:async()=>badHistory?{verified:false}:
  verifyR176AnchorChain({entries:receipts.map((receipt,i)=>({
   receipt,sha256:locators[i].sha256,versionId:locators[i].versionId
  })),checkpoint,bundleSha256,...pins,clock})};
 const circuit={snapshot:()=>({stopped:true}),trip:async x=>{
  incidents.push(x);return{accepted:true};}};
 const sut=createR177OffsiteReconciler({readCheckpoint,
  chainReader,witnessStore,readWitnesses:async()=>extraRow?
   [...saved,{...rows[0]}]:saved,incidentCircuit:circuit,
  allowReconcile:true});
 return{sut,saved,incidents};
}
test('R177 reconciles signed remote lineage with exact independent PG17 witnesses',async()=>{
 const f=fixture();
 const result=await f.sut.reconcile({locators,bundleSha256,...pins});
 assert.equal(result.anchorCount,2);
 assert.equal(result.rootSha256,r177HistoryDigest(rows));
 assert.equal(result.productionAuthorized,false);
 assert.equal(f.saved.length,2);assert.equal(f.incidents.length,0);
});
test('R177 denies unverified offsite, changed high-water, inserted row and PG outage',async()=>{
 for(const patch of [{badHistory:true},{highwaterMoves:true},
  {extraRow:true},{failInsert:true}]){
  const f=fixture(patch);
  await assert.rejects(f.sut.reconcile({
   locators,bundleSha256,...pins}),/R177 offsite reconciliation/);
  assert.equal(f.incidents.length,1);
 }
});
test('R177 outcome ties exact R176 admission, pinned root and restored SHA',async()=>{
 const args={nonce:'9'.repeat(32),sequence:2,
  rootSha256:r177HistoryDigest(rows),
  restoredStateSha256:'4'.repeat(64),sourceCommit:commit,
  archiveSha256:raw[1].archiveSha256,
  checkpointSha256:raw[1].checkpointSha256,
  objectSha256:locators[1].sha256};
 const s=r177RecordOutcomeSql(args);
 for(const x of ['r176_ci.admissions','r177_ci.roots','r177_ci.anchors',
  'r174_ci.checkpoint','r177_ci.outcome_audit'])
 assert.ok(s.includes(x));
 assert.equal((await createR177RestoreOutcomeStore({
  executeSql:async()=> 'BEGIN\n1|1\nCOMMIT'
 }).record(args)).productionAuthorized,false);
 for(const invalid of [{nonce:'bad'},{restoredStateSha256:'wrong'},
  {sequence:33}])
 assert.throws(()=>r177RecordOutcomeSql({...args,...invalid}),
  /R177 restore outcome/);
 await assert.rejects(createR177RestoreOutcomeStore({
  executeSql:async()=> 'BEGIN\n0|0\nCOMMIT'
 }).record(args),/R177 restore outcome/);
});
