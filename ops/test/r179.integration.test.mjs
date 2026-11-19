import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {createR179GithubApprovalAudit,verifyR179GithubApprovalProof}
 from '../r179/github-approval-audit.mjs';
import {createR179ReplicationProvenance,verifyR179ReplicationProof}
 from '../r179/replication-provenance.mjs';
import {createR179ReviewGate} from '../r179/review-gate.mjs';
import {r179ReviewEvidenceSql,createR179StagingLedger}
 from '../r179/staging-ledger.mjs';
import {createR178ReplicaAudit} from '../r178/replica-audit.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const now=1800000000000,clock=()=>now,commit='a'.repeat(40);
const bundleSha256='b'.repeat(64),historyRootSha256='c'.repeat(64);
const source={accountId:'111122223333',region:'eu-west-1',
 bucket:'marcosa-source-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
const offsite={accountId:'444455556666',region:'eu-central-1',
 bucket:'marcosa-offsite-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
const key=randomBytes(32),iv=randomBytes(12);
const cipher=createCipheriv('aes-256-gcm',key,iv);
const body=Buffer.concat([iv,cipher.update(Buffer.alloc(640,0x5b)),
 cipher.final(),cipher.getAuthTag()]);
key.fill(0);
const probeSha256=sha(body);
const sourceVersionId='s179-immutable-1',offsiteVersionId='d179-replica-2';
const runId=12345678,actorId=1001,reviewerIds=[2002,3003];
const names=['GetBucketVersioning','GetObjectLockConfiguration',
 'GetPublicAccessBlock','HeadObject','GetObjectRetention','GetObject',
 'GetBucketReplication'];
const commands=Object.fromEntries(names.map(type=>[
 type+'Command',class{constructor(input){this.type=type;this.input=input;}}
]));
const githubRun={id:runId,head_sha:commit,
 head_branch:'feature/marcosa-r150-growth-economics',
 event:'workflow_dispatch',run_attempt:1,actor:{id:actorId,type:'User'},
 repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
 head_repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
 path:'.github/workflows/marcosa-r179-readiness.yml@refs/heads/feature/marcosa-r150-growth-economics',
 status:'in_progress',run_started_at:new Date(now-1000).toISOString()};
const reviews=reviewerIds.map(id=>({state:'approved',
 user:{id,type:'User'},environments:[{id:99,name:'marcosa-aws-staging',
  updated_at:new Date(now-500).toISOString()}]}));
const netArgs={commit,bundleSha256,historyRootSha256,sha256:probeSha256,
 sourceVersionId,offsiteVersionId};
function github({wrongSha=false,self=false,reject=false,
 duplicate=false,wrongEnv=false,down=false}={}){
 const history=reviews.map(x=>structuredClone(x));
 if(self)history[0].user.id=actorId;
 if(reject)history[0].state='rejected';
 if(duplicate)history[1].user.id=history[0].user.id;
 if(wrongEnv)history[0].environments[0].name='prod';
 const fetcher=async url=>{
  if(down)throw Error('GitHub disconnected');
  assert.equal(new URL(url).hostname,'api.github.com');
  const contents=url.endsWith('/approvals')?history:
   {...githubRun,head_sha:wrongSha?'f'.repeat(40):commit};
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(contents)};
 };
 return createR179GithubApprovalAudit({fetcher,token:'test-token-not-real',
  runId,commit,actorId,reviewerIds,clock,allowExternalCalls:true});
}
function s3({wrongStatus=false,wrongRole=false,
 changedCiphertext=false,missingLock=false,wrongRule=false,
 truncated=false}={}){
 const checksum=Buffer.from(probeSha256,'hex').toString('base64');
 const create=(scope,version,isOffsite)=>({...scope,
  client:{send:async cmd=>{
   assert.equal(cmd.input.ExpectedBucketOwner,scope.accountId);
   assert.equal(cmd.input.Bucket,scope.bucket);
   switch(cmd.type){
    case 'GetBucketReplication':return{ReplicationConfiguration:{
     Role:'arn:aws:iam::'+source.accountId+
      ':role/'+(wrongRole?'other-role':'marcosa-staging-cross-account-replication'),
     Rules:[{Status:'Enabled',Filter:{
      Prefix:wrongRule?'random/':'marcosa/isolated/r178/archive/'},
      DeleteMarkerReplication:{Status:'Disabled'},
      Destination:{Bucket:'arn:aws:s3:::'+offsite.bucket,
       Account:offsite.accountId}}]}};
    case 'GetBucketVersioning':return{Status:'Enabled'};
    case 'GetObjectLockConfiguration':return{
     ObjectLockConfiguration:{ObjectLockEnabled:'Enabled'}};
    case 'GetPublicAccessBlock':return{
     PublicAccessBlockConfiguration:{BlockPublicAcls:true,
      IgnorePublicAcls:true,BlockPublicPolicy:true,
      RestrictPublicBuckets:true}};
    case 'HeadObject':return{
     VersionId:version,ReplicationStatus:wrongStatus?'PENDING':
      isOffsite?'REPLICA':'COMPLETED',
     ContentLength:body.length,ChecksumSHA256:checksum,
     ContentType:'application/vnd.marcosa.r178-encrypted-archive',
     ServerSideEncryption:'aws:kms',SSEKMSKeyId:scope.kmsKeyArn,
     ObjectLockMode:missingLock?'GOVERNANCE':'COMPLIANCE',
     ObjectLockRetainUntilDate:new Date(now+8*86400000),
     Metadata:{'marcosa-commit':commit,
      'marcosa-bundle-sha256':bundleSha256,
      'marcosa-history-root-sha256':historyRootSha256}};
    case 'GetObjectRetention':return{Retention:{
     Mode:'COMPLIANCE',RetainUntilDate:new Date(now+8*86400000)}};
    case 'GetObject':return{
     VersionId:version,ContentLength:body.length,
     ChecksumSHA256:checksum,Body:changedCiphertext?
      Buffer.alloc(body.length,0x5e):truncated?body.subarray(0,20):Buffer.from(body)};
    default:throw Error('unsupported SDK method');
   }
  }}});
 return{source:create(source,sourceVersionId,false),
  offsite:create(offsite,offsiteVersionId,true)};
}
function pair(options={}){
 const clients=s3(options);
 return{
  full:createR178ReplicaAudit({...clients,commands,clock,allowExternalCalls:true}),
  provenance:createR179ReplicationProvenance({
   ...clients,commands,clock,allowExternalCalls:true})
 };
}
const r178Manifest={
 schemaVersion:1,scope:'isolated-read-only-staging-simulation',
 commit,bundleSha256,sequence:3,
 archiveSha256:'d'.repeat(64),checkpointSha256:'e'.repeat(64),
 historyRootSha256,latestObjectSha256:'f'.repeat(64),
 restoredStateSha256:'1'.repeat(64),nonce:'2'.repeat(32),probeSha256,
 sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
 sourceVersionId,offsiteVersionId,
 identityEvidenceSha256:'3'.repeat(64),iamPlanSha256:'4'.repeat(64),
 replicaEvidenceSha256:'5'.repeat(64),
 verifiedPg17ReadbackTwice:true,syntheticCiScopeOnly:true,
 realIamPolicyApplied:false,humanApprovalVerified:false,
 actualAwsAccountsIndependentlyVerified:false,productionAuthorized:false
};
const r178Proof={...r178Manifest,
 evidenceSha256:sha(JSON.stringify(r178Manifest)),
 decision:'CI_SIMULATION_COMPLETE'};
const witness={
 sequence:3,nonce:r178Proof.nonce,commit,
 rootSha256:historyRootSha256,archiveSha256:r178Proof.archiveSha256,
 restoredStateSha256:r178Proof.restoredStateSha256,
 probeSha256,sourceAccountId:source.accountId,
 offsiteAccountId:offsite.accountId,
 evidenceSha256:r178Proof.evidenceSha256,productionAuthorized:false
};
function gate({race=false,wrongR178=false,wrongGitHub=false,
 wrongCipher=false,wrongStatus=false}={}){
 let reads=0;
 const pairs=pair({changedCiphertext:wrongCipher,wrongStatus});
 return createR179ReviewGate({
  readR178Witness:async()=>{
   reads++;return wrongR178?{...witness,productionAuthorized:true}:
    race&&reads>1?{...witness,sequence:4}:witness;},
  githubAudit:github({reject:wrongGitHub}),
  replicaReadback:pairs.full,replicationAudit:pairs.provenance,
  clock,allowEvaluate:true
 });
}
const gateArgs={r178Proof,runId,actorId,commit,bundleSha256,
 historyRootSha256,probeSha256,sourceVersionId,offsiteVersionId};
test('R179 actual GitHub REST approval history parser rejects duplicate, self, rejection, SHA and API outage',async()=>{
 const p=await github().inspect();
 assert.equal(p.reviewers.length,2);
 assert.equal(p.productionAuthorized,false);
 assert.equal(verifyR179GithubApprovalProof(p,{commit,runId,actorId,clock}).verified,true);
 for(const opts of [{wrongSha:true},{self:true},{reject:true},
  {duplicate:true},{wrongEnv:true},{down:true}])
  await assert.rejects(github(opts).inspect(),/R179 GitHub approvals/);
 assert.throws(()=>verifyR179GithubApprovalProof({...p,
  actualHumanIdentityVerified:true},{commit,runId,actorId,clock}),
  /R179 GitHub approvals/);
});
test('R179 requires exact offsite COMPLETED/REPLICA status AND fresh real-content readback',async()=>{
 const p=pair();
 const full=await p.full.inspect({sha256:probeSha256,
  sourceVersionId,offsiteVersionId,commit,bundleSha256,historyRootSha256});
 const proof=await p.provenance.inspect({...netArgs,r178Proof:full});
 assert.equal(proof.verified,true);
 assert.equal(proof.actualCrossAccountDeliveryIndependentlyVerified,false);
 assert.equal(verifyR179ReplicationProof(proof,{
  commit,bundleSha256,historyRootSha256,
  sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
  clock}).verified,true);
 for(const opts of [{wrongStatus:true},{wrongRole:true},
  {wrongRule:true},{missingLock:true}]){
  const clients=pair(opts);
  await assert.rejects(clients.provenance.inspect({...netArgs,r178Proof:full}),
   /R179 replication provenance/);
 }
 await assert.rejects(p.provenance.inspect({...netArgs,
  r178Proof:{...full,archiveSha256:'0'.repeat(64)}}),
 /R179 replication provenance/);
});
test('R179 PG17-bound gate refuses fabricated approvals, stale root, changed bytes and concurrent update',async()=>{
 const record=await gate().inspect(gateArgs);
 assert.equal(record.decision,'CI_SIMULATED_REVIEW_ONLY');
 assert.equal(record.productionAuthorized,false);
 assert.equal(record.githubReviewEventsShapeValid,true);
 assert.equal(record.actualHumanApprovalsVerified,false);
 for(const opts of [{race:true},{wrongR178:true},
  {wrongGitHub:true},{wrongCipher:true},{wrongStatus:true}])
  await assert.rejects(gate(opts).inspect(gateArgs),
   /R179 review gate|R179 GitHub approvals|R179 replication provenance|R178 replica audit/);
 await assert.rejects(gate().inspect({...gateArgs,
  r178Proof:{...r178Proof,archiveSha256:'8'.repeat(64)}}),
  /R179 review gate/);
});
test('R179 PostgreSQL SERIALIZABLE single-use review and independent audit can never promote',async()=>{
 const input=await gate().inspect(gateArgs);
 const sql=r179ReviewEvidenceSql(input);
 for(const needle of ['SERIALIZABLE','marcosa_r179_writer',
  'r178_ci.staging_evidence','r178_ci.staging_audit',
  'r177_ci.outcomes','r179_ci.review_audit','ON CONFLICT DO NOTHING'])
  assert.ok(sql.includes(needle),needle);
 for(const wrong of [{decision:'PRODUCTION_GO'},{actorId:0},
  {githubEvidenceSha256:'bad'},{nonce:"' OR 1=1"}])
  assert.throws(()=>r179ReviewEvidenceSql({...input,...wrong}),
   /R179 staging ledger/);
 let i=0;
 const ledger=createR179StagingLedger({executeSql:async()=>i++===0?
  'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'});
 assert.equal((await ledger.record(input)).recorded,true);
 await assert.rejects(ledger.record(input),/R179 staging ledger/);
 await assert.rejects(createR179StagingLedger({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).record(input),/R179 staging ledger/);
});
