import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createR178DualIdentityAudit,verifyR178IdentityProof} from '../r178/identity-audit.mjs';
import {createR178ReplicaAudit} from '../r178/replica-audit.mjs';
import {buildR178ReadOnlyIamBlueprint,verifyR178ReadOnlyIamBlueprint} from '../r178/iam-plan.mjs';
import {createR178ReadinessGate} from '../r178/readiness-gate.mjs';
import {r178StagingEvidenceSql,createR178StagingLedger} from '../r178/staging-ledger.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const clock=()=>1800000000000,commit='a'.repeat(40);
const bundleSha256='b'.repeat(64),historyRootSha256='c'.repeat(64);
const source={accountId:'111122223333',region:'eu-west-1',bucket:'marcosa-source-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
const offsite={accountId:'444455556666',region:'eu-central-1',bucket:'marcosa-offsite-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
const runId='1234567890';
const commands=Object.fromEntries([
 'GetCallerIdentity','GetBucketVersioning','GetObjectLockConfiguration',
 'GetPublicAccessBlock','HeadObject','GetObjectRetention','GetObject'
].map(type=>[type+'Command',class{constructor(input){this.type=type;this.input=input;}}]));
const blob=Buffer.alloc(1024,0x5a),probeSha256=hash(blob);
const sourceVersionId='source-178-v1',offsiteVersionId='offsite-178-v2';
const probe={sha256:probeSha256,sourceVersionId,offsiteVersionId,
 commit,bundleSha256,historyRootSha256};
const blueprint=buildR178ReadOnlyIamBlueprint({source,offsite});
function identity({bad=false,down=false}={}){
 const make=(s,roleId)=>({...s,roleId,client:{send:async()=>{
  if(down)throw Error('no STS');
  return{Account:bad?'000000000000':s.accountId,
   Arn:'arn:aws:sts::'+s.accountId+
    ':assumed-role/marcosa-r178-readonly-auditor/marcosa-r178-'+runId,
   UserId:roleId+':marcosa-r178-'+runId};
 }}});
 return createR178DualIdentityAudit({
  source:make(source,'AROA'+'A'.repeat(16)),
  offsite:make(offsite,'AROA'+'B'.repeat(16)),
  commands,runId,commit,bundleSha256,clock,allowExternalCalls:true});
}
function replica({badBytes=false,badRetention=false,publicGrant=false,
 badVersion=false,down=false,shortBody=false}={}){
 const make=(s,versionId)=>({...s,client:{send:async cmd=>{
  if(down)throw Error('S3 disconnected');
  assert.equal(cmd.input.ExpectedBucketOwner,s.accountId);
  const checksum=Buffer.from(probeSha256,'hex').toString('base64');
  switch(cmd.type){
   case 'GetBucketVersioning':return{Status:'Enabled'};
   case 'GetObjectLockConfiguration':
    return{ObjectLockConfiguration:{ObjectLockEnabled:'Enabled'}};
   case 'GetPublicAccessBlock':
    return{PublicAccessBlockConfiguration:{BlockPublicAcls:true,
     IgnorePublicAcls:true,BlockPublicPolicy:true,
     RestrictPublicBuckets:!publicGrant}};
   case 'HeadObject':return{VersionId:badVersion?'wrong':versionId,
    ContentLength:blob.length,ContentType:'application/vnd.marcosa.r178-encrypted-archive',
    ServerSideEncryption:'aws:kms',SSEKMSKeyId:s.kmsKeyArn,
    ObjectLockMode:'COMPLIANCE',ObjectLockRetainUntilDate:new Date(clock()+8*86400000),
    ChecksumSHA256:checksum,Metadata:{
     'marcosa-commit':commit,'marcosa-bundle-sha256':bundleSha256,
     'marcosa-history-root-sha256':historyRootSha256}};
   case 'GetObjectRetention':return{Retention:{
    Mode:badRetention?'GOVERNANCE':'COMPLIANCE',
    RetainUntilDate:new Date(clock()+8*86400000)}};
   case 'GetObject':return{VersionId:versionId,ContentLength:blob.length,
    ChecksumSHA256:checksum,Body:badBytes?Buffer.alloc(1024,0x01):
     shortBody?Buffer.alloc(22,0x5a):Buffer.from(blob)};
   default:throw Error('unexpected command');
  }
 }}});
 return createR178ReplicaAudit({source:make(source,sourceVersionId),
  offsite:make(offsite,offsiteVersionId),commands,clock,
  allowExternalCalls:true});
}
const db={sequence:3,commit,bundleSha256,
 archiveSha256:'d'.repeat(64),checkpointSha256:'e'.repeat(64),
 historyRootSha256,latestObjectSha256:'f'.repeat(64),
 nonce:'1'.repeat(32),restoredStateSha256:'2'.repeat(64),
 productionAuthorized:false};
function gate({race=false,wrongDb=false,wrongSts=false,wrongS3=false}={}){
 let reads=0;
 return createR178ReadinessGate({readPostgres:async()=>{
  reads++;return wrongDb?{...db,productionAuthorized:true}:
   race&&reads===2?{...db,sequence:4}:db;},
  identityAudit:identity({bad:wrongSts}),
  replicaAudit:replica({badBytes:wrongS3}),
  iamBlueprint:blueprint,source,offsite,clock,allowEvaluate:true});
}
test('R178 two STS sessions pinned to independent accounts',async()=>{
 const evidence=await identity().inspect();
 assert.equal(evidence.verified,true);
 assert.equal(evidence.productionAuthorized,false);
 assert.equal(verifyR178IdentityProof(evidence,{commit,bundleSha256,
  sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
  clock}).verified,true);
 await assert.rejects(identity({bad:true}).inspect(),/R178 identity audit/);
 await assert.rejects(identity({down:true}).inspect(),/R178 identity audit/);
 assert.throws(()=>verifyR178IdentityProof(evidence,{commit,bundleSha256,
  sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
  clock:()=>clock()+60001}),/R178 identity audit/);
});
test('R178 IAM blueprint forbids wildcard subject and expanded privileges',()=>{
 assert.equal(verifyR178ReadOnlyIamBlueprint(blueprint,{source,offsite}).verified,true);
 const changed=structuredClone(blueprint);
 changed.plans[0].permissionsPolicy.Statement[1].Action.push('s3:PutObject');
 assert.throws(()=>verifyR178ReadOnlyIamBlueprint(changed,{source,offsite}),/R178 IAM plan/);
 const trust=structuredClone(blueprint);
 trust.plans[0].trustPolicy.Statement[0].Condition
  .StringEquals['token.actions.githubusercontent.com:sub']='repo:*';
 assert.throws(()=>verifyR178ReadOnlyIamBlueprint(trust,{source,offsite}),/R178 IAM plan/);
});
test('R178 source/offsite exact immutable ciphertext parity without decryption',async()=>{
 const evidence=await replica().inspect(probe);
 assert.equal(evidence.verified,true);
 assert.equal(evidence.encryptedBytes,1024);
 assert.equal(evidence.actualCrossAccountReplicaDeliveryProven,false);
 assert.equal(evidence.productionAuthorized,false);
});
test('R178 rejects corruption, partial GET, S3 Object Lock downgrade, public ACL and version swap',async()=>{
 for(const options of [{badBytes:true},{shortBody:true},{badRetention:true},
  {publicGrant:true},{badVersion:true},{down:true}])
  await assert.rejects(replica(options).inspect(probe),/R178 replica audit/);
});
test('R178 readiness requires two matching PostgreSQL reads and refuses false AWS claims',async()=>{
 const readiness=await gate().inspect({commit,bundleSha256,historyRootSha256,
  probeSha256,sourceVersionId,offsiteVersionId});
 assert.equal(readiness.decision,'CI_SIMULATION_COMPLETE');
 assert.equal(readiness.syntheticCiScopeOnly,true);
 assert.equal(readiness.productionAuthorized,false);
 for(const options of [{race:true},{wrongDb:true},{wrongSts:true},{wrongS3:true}])
  await assert.rejects(gate(options).inspect({commit,bundleSha256,
   historyRootSha256,probeSha256,sourceVersionId,offsiteVersionId}),
   /R178 readiness gate|R178 identity audit|R178 replica audit/);
});
test('R178 native PG17 serializable evidence and audit deny replay and promotion',async()=>{
 const proof=await gate().inspect({commit,bundleSha256,historyRootSha256,
  probeSha256,sourceVersionId,offsiteVersionId});
 const sql=r178StagingEvidenceSql(proof);
 for(const needle of ['SERIALIZABLE','marcosa_r178_writer','r174_ci.checkpoint',
  'r177_ci.roots','r177_ci.outcomes','r178_ci.staging_audit'])
  assert.ok(sql.includes(needle));
 for(const patch of [{nonce:'bad'},{decision:'PRODUCTION_GO'},
  {identityEvidenceSha256:'invalid'}])
  assert.throws(()=>r178StagingEvidenceSql({...proof,...patch}),
   /R178 staging ledger/);
 let n=0;
 const store=createR178StagingLedger({executeSql:async()=>
  n++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'});
 assert.equal((await store.record(proof)).recorded,true);
 await assert.rejects(store.record(proof),/R178 staging ledger/);
 await assert.rejects(createR178StagingLedger({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).record(proof),/R178 staging ledger/);
});
