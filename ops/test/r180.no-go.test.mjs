import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {classifyR180Evidence,verifyR180Classification,R180_EXTERNAL_BLOCKERS}
 from '../r180/evidence-classifier.mjs';
import {issueR180Quorum,verifyR180Quorum,r180SignerPin}
 from '../r180/quorum-attestation.mjs';
import {r180HoldSql,createR180HoldLedger} from '../r180/hold-ledger.mjs';
import {createR180HoldGate} from '../r180/hold-gate.mjs';
const sha=x=>createHash('sha256').update(
 typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const when=1800000000000,clock=()=>when;
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const r179Manifest={
 schemaVersion:1,scope:'isolated-staging-review-simulation',
 decision:'CI_SIMULATED_REVIEW_ONLY',
 commit,bundleSha256,sequence:3,nonce:'1'.repeat(32),
 archiveSha256:'2'.repeat(64),
 historyRootSha256:'3'.repeat(64),
 restoredStateSha256:'4'.repeat(64),probeSha256:'5'.repeat(64),
 sourceAccountId:'111122223333',offsiteAccountId:'444455556666',
 runId:123456789,actorId:1001,
 r178EvidenceSha256:'6'.repeat(64),
 githubEvidenceSha256:'7'.repeat(64),
 replicationEvidenceSha256:'8'.repeat(64),
 githubReviewEventsShapeValid:true,replicationStatusShapeValid:true,
 actualHumanApprovalsVerified:false,realAwsDeliveryVerified:false,
 actualGitHubProviderIndependentlyVerified:false,
 productionAuthorized:false
};
const r179Proof={...r179Manifest,
 evidenceSha256:sha(r179Manifest)};
const r179Report={
 schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
 historyRootSha256:r179Proof.historyRootSha256,
 sourceAccountId:r179Proof.sourceAccountId,
 offsiteAccountId:r179Proof.offsiteAccountId,
 reviewEvidenceSha256:r179Proof.evidenceSha256,
 reviewProof:r179Proof,realPg17ImmutableReviewAndAudit:true,
 realPg17NativeBackupRestoreAndRls:true,
 realPg17SeparateProcessReplayDenied:true,
 syntheticGitHubReviewHistoryAndNoSelfReview:true,
 syntheticS3ReplicationAndFullEncryptedBytes:true,
 actualGitHubReviewersVerified:false,actualAwsReplicaVerified:false,
 productionAuthorized:false
};
const op=generateKeyPairSync('ed25519'),au=generateKeyPairSync('ed25519');
const expectedOperatorPin=r180SignerPin(op.privateKey),
 expectedAuditorPin=r180SignerPin(au.privateKey);
const classify=()=>classifyR180Evidence(r179Report,{commit,bundleSha256,clock});
const signed=classification=>issueR180Quorum({
 classification,operatorPrivateKey:op.privateKey,
 auditorPrivateKey:au.privateKey,expectedOperatorPin,
 expectedAuditorPin,clock});
const witness=()=>{
 const p=r179Proof;
 return{runId:p.runId,sequence:p.sequence,nonce:p.nonce,
  sourceCommit:commit,historyRootSha256:p.historyRootSha256,
  archiveSha256:p.archiveSha256,restoredStateSha256:p.restoredStateSha256,
  reviewEvidenceSha256:p.evidenceSha256,
  decision:'CI_SIMULATED_REVIEW_ONLY',productionAuthorized:false};
};
const args=()=>{
 const classification=classify();
 return{report:r179Report,classification,quorum:signed(classification),
  commit,bundleSha256,expectedOperatorPin,expectedAuditorPin};
};
test('R180 exact R179 report is always classified NO-GO with five blockers',()=>{
 const c=classify();
 assert.equal(c.decision,'NO_GO_EXTERNAL_EVIDENCE_PENDING');
 assert.deepEqual([...c.blockers],R180_EXTERNAL_BLOCKERS);
 assert.equal(c.productionAuthorized,false);
 assert.equal(c.nativePg17BackupAndRlsChecked,true);
 assert.equal(verifyR180Classification(c,{commit,bundleSha256,clock}).noGo,true);
 const parsed=JSON.parse(JSON.stringify(c));
 assert.equal(verifyR180Classification(parsed,{commit,bundleSha256,clock}).noGo,true);
});
test('R180 denies inflated provider claims, manipulated R179 SHA and stale/extra fields',()=>{
 for(const wrong of [
  {...r179Report,actualAwsReplicaVerified:true},
  {...r179Report,actualGitHubReviewersVerified:true},
  {...r179Report,reviewEvidenceSha256:'9'.repeat(64)},
  {...r179Report,realPg17NativeBackupRestoreAndRls:false},
  {...r179Report,notReviewed:true},
  {...r179Report,reviewProof:{...r179Proof,
   actualHumanApprovalsVerified:true}},
  {...r179Report,reviewProof:{...r179Proof,
   evidenceSha256:'0'.repeat(64)}}
 ])assert.throws(()=>classifyR180Evidence(wrong,{commit,bundleSha256,clock}),
  /R180 evidence classifier/);
 const c=classify();
 for(const fake of [{...c,productionAuthorized:true},
  {...c,decision:'PRODUCTION_GO'},
  {...c,blockers:[]},
  {...c,realCloudReplicationVerified:true}])
 assert.throws(()=>verifyR180Classification(fake,{commit,bundleSha256,clock}),
  /R180 evidence classifier/);
 assert.throws(()=>verifyR180Classification(c,{commit,bundleSha256,
  clock:()=>when+1800001}),/R180 evidence classifier/);
});
test('R180 Ed25519 dual signed packet is precise, source-bound, and not human approvals',()=>{
 const classification=classify(),receipt=signed(classification);
 assert.equal(receipt.packet.decision,'NO_GO_EXTERNAL_EVIDENCE_PENDING');
 assert.equal(receipt.actualHumanApprovalsVerified,false);
 assert.equal(verifyR180Quorum(receipt,{commit,bundleSha256,
  classificationSha256:classification.evidenceSha256,
  expectedOperatorPin,expectedAuditorPin,clock}).twoDistinctKeys,true);
 const roundTrip=JSON.parse(JSON.stringify(receipt));
 assert.equal(verifyR180Quorum(roundTrip,{commit,bundleSha256,
  classificationSha256:classification.evidenceSha256,
  expectedOperatorPin,expectedAuditorPin,clock}).verified,true);
 for(const bad of [
  {...receipt,packet:{...receipt.packet,decision:'PRODUCTION_GO'}},
  {...receipt,packet:{...receipt.packet,sequence:4}},
  {...receipt,approvals:receipt.approvals.toReversed()},
  {...receipt,approvals:[receipt.approvals[0],receipt.approvals[0]]},
  {...receipt,approvals:[receipt.approvals[0],{
   ...receipt.approvals[1],signatureBase64:receipt.approvals[0].signatureBase64
  }]}
 ])assert.throws(()=>verifyR180Quorum(bad,{commit,bundleSha256,
  classificationSha256:classification.evidenceSha256,
  expectedOperatorPin,expectedAuditorPin,clock}),/R180 quorum/);
 assert.throws(()=>issueR180Quorum({
  classification,operatorPrivateKey:op.privateKey,
  auditorPrivateKey:op.privateKey,
  expectedOperatorPin,expectedAuditorPin,clock}),/R180 quorum/);
 assert.throws(()=>verifyR180Quorum(receipt,{commit,bundleSha256,
  classificationSha256:classification.evidenceSha256,
  expectedOperatorPin,expectedAuditorPin,
  clock:()=>when+600001}),/R180 quorum/);
 assert.equal(verifyR180Quorum(receipt,{commit,bundleSha256,
  classificationSha256:classification.evidenceSha256,
  expectedOperatorPin,expectedAuditorPin,
  clock:()=>when+700000,historicalRead:true}).fresh,false);
});
test('R180 SQL NO-GO forbids arbitrary SQL, R179 drift, duplicate ledger and elevated decisions',async()=>{
 const a=args();
 const p={runId:a.classification.runId,sequence:a.classification.sequence,
  nonce:a.classification.nonce,sourceCommit:commit,
  historyRootSha256:a.classification.historyRootSha256,
  archiveSha256:a.classification.archiveSha256,
  restoredStateSha256:a.classification.restoredStateSha256,
  reviewEvidenceSha256:a.classification.reviewEvidenceSha256,
  classificationSha256:a.classification.evidenceSha256,
  quorumReceiptSha256:a.quorum.receiptSha256,
  operatorPinSha256:expectedOperatorPin,auditorPinSha256:expectedAuditorPin,
  blockerCount:5,decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING'};
 const sql=r180HoldSql(p);
 for(const needle of ['SERIALIZABLE','SET LOCAL ROLE marcosa_r180_writer',
  'r179_ci.review_evidence','r179_ci.review_audit',
  'r178_ci.staging_evidence','ON CONFLICT DO NOTHING',
  'r180_ci.hold_audit'])
 assert.ok(sql.includes(needle),needle);
 for(const bad of [{decision:'PRODUCTION_GO'},{blockerCount:0},
  {operatorPinSha256:expectedAuditorPin},{nonce:"' OR 1=1"}])
 assert.throws(()=>r180HoldSql({...p,...bad}),/R180 hold ledger/);
 let n=0;
 const store=createR180HoldLedger({
  executeSql:async()=>n++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'
 });
 assert.equal((await store.record(p)).recorded,true);
 await assert.rejects(store.record(p),/R180 hold ledger/);
 await assert.rejects(createR180HoldLedger({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).record(p),/R180 hold ledger/);
});
function fixture({race=false,openQuarantine=false,
 invalidAudit=false,down=false,wrongReadback=false,brokenIncident=false}={}){
 const source=witness(),events=[];
 let readCount=0,writeCount=0;
 const quarantine={status:async()=>({
  closed:!openQuarantine,generation:6})};
 const incidentCircuit={trip:async ev=>{
  events.push(ev);
  if(brokenIncident)throw Error('incident ledger failed');
  return{accepted:true};
 }};
 const ledger={record:async p=>{
  writeCount++;
  if(down)throw Error('SQL timeout');
  return{recorded:true,
   classificationSha256:p.classificationSha256,
   quorumReceiptSha256:p.quorumReceiptSha256,
   decision:p.decision,productionAuthorized:false};
 }};
 const params=args();
 const readHold=async()=>({
  runId:params.classification.runId,
  sequence:params.classification.sequence,
  nonce:params.classification.nonce,
  sourceCommit:commit,
  classificationSha256:wrongReadback?'bad':
   params.classification.evidenceSha256,
  quorumReceiptSha256:params.quorum.receiptSha256,
  decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING',
  productionAuthorized:false
 });
 const gate=createR180HoldGate({
  readR179Witness:async()=>{
   readCount++;
   return invalidAudit?{...source,decision:'PRODUCTION_GO'}:
    race&&readCount>1?{...source,sequence:4}:source;
  },holdLedger:ledger,readRecordedHold:readHold,
  quarantine,incidentCircuit,clock,allowHold:true});
 return{gate,params,stats:()=>({readCount,writeCount,events})};
}
test('R180 durable no-go gate double reads R179 and confirms closed quarantine',async()=>{
 const f=fixture();
 const r=await f.gate.record(f.params);
 assert.equal(r.recordedNoGo,true);
 assert.equal(r.decision,'NO_GO_EXTERNAL_EVIDENCE_PENDING');
 assert.equal(r.productionAuthorized,false);
 assert.equal(r.actualHumanApprovalsVerified,false);
 assert.equal(r.blockerCount,5);
 assert.equal(f.stats().readCount,3);
 assert.equal(f.stats().writeCount,1);
 assert.deepEqual(f.stats().events,[]);
});
test('R180 denial path blocks changed source, released quarantine, SQL failure and lost audit',async()=>{
 for(const bad of [{race:true},{openQuarantine:true},
  {invalidAudit:true},{down:true},{wrongReadback:true},
  {down:true,brokenIncident:true}]){
  const f=fixture(bad);
  await assert.rejects(f.gate.record(f.params),/R180 hold gate/);
  assert.equal(f.stats().events.length,1);
  if(bad.race||bad.openQuarantine||bad.invalidAudit)
   assert.equal(f.stats().writeCount,0);
 }
 const f=fixture();
 await assert.rejects(f.gate.record({...f.params,
  quorum:{...f.params.quorum,receiptSha256:'f'.repeat(64)}}),
 /R180 hold gate/);
 assert.equal(f.stats().writeCount,0);
});
