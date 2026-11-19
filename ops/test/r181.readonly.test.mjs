import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,randomBytes} from 'node:crypto';
import {createR181GithubPolicyInspector}
 from '../r181/github-policy-inspector.mjs';
import {createR181AwsReadOnlyProbe,createR181AwsCliExecutor}
 from '../r181/aws-readonly-cli.mjs';
import {createR181StagingEvaluator}
 from '../r181/staging-evaluator.mjs';
import {r181ObservationSql,createR181ObservationLedger}
 from '../r181/observation-ledger.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const now=1800000000000,clock=()=>now,commit='a'.repeat(40);
const bundleSha256='b'.repeat(64),historyRootSha256='c'.repeat(64);
const runId=123456789,actorId=1001,reviewerIds=[2002,3003];
const profile={source:{profile:'source_ci',region:'eu-west-1',
 accountId:'111122223333',bucket:'marcosa-source-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'},
 offsite:{profile:'offsite_ci',region:'eu-central-1',
 accountId:'444455556666',bucket:'marcosa-offsite-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'}};
const key=randomBytes(32),iv=randomBytes(12),
 cipher=createCipheriv('aes-256-gcm',key,iv);
const bytes=Buffer.concat([iv,cipher.update(Buffer.alloc(700,0x2a)),
 cipher.final(),cipher.getAuthTag()]);
key.fill(0);
const objectSha256=sha(bytes),sourceVersionId='r181-source-v1',
 offsiteVersionId='r181-dest-v2';
const args={commit,bundleSha256,historyRootSha256,sha256:objectSha256,
 sourceVersionId,offsiteVersionId};
function github({self=false,onlyOne=false,unprotected=false,
 branchForbidden=false,pending=false,changedSha=false,
 badRule=false,duplicate=false}={}){
 const env={id:91,name:'marcosa-aws-staging',
  deployment_branch_policy:{protected_branches:true,
   custom_branch_policies:false},
  protection_rules:[
   {type:'branch_policy',id:4},
   {type:'required_reviewers',id:5,prevent_self_review:!badRule,
    reviewers:reviewerIds.map(id=>({type:'User',
     reviewer:{id,type:'User'}}))}
  ]};
 const protection={required_status_checks:{strict:true},
  enforce_admins:{enabled:true},
  required_pull_request_reviews:{dismiss_stale_reviews:true,
   required_approving_review_count:2},
  allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}};
 const run={id:runId,head_sha:changedSha?'d'.repeat(40):commit,
  head_branch:'feature/marcosa-r150-growth-economics',
  event:'workflow_dispatch',run_attempt:1,
  actor:{id:actorId,type:'User'},
  repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
  head_repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
  path:'.github/workflows/marcosa-r181-readiness.yml',
  run_started_at:new Date(now-2000).toISOString()};
 const reviews=(onlyOne?reviewerIds.slice(0,1):reviewerIds)
 .map(id=>({state:pending?'pending':'approved',
  user:{id,type:'User'},environments:[{id:91,
   name:'marcosa-aws-staging',
   updated_at:new Date(now-1000).toISOString()}]}));
 if(self)reviews[0].user.id=actorId;
 if(duplicate)reviews[1].user.id=reviews[0].user.id;
 const fetcher=async url=>{
  let body;
  if(url.includes('/environments/'))body={
   ...env,deployment_branch_policy:unprotected?
    {protected_branches:false,custom_branch_policies:true}:
    env.deployment_branch_policy};
  else if(url.includes('/protection'))body=protection;
  else if(url.endsWith('/approvals'))body=reviews;
  else body=run;
  return{status:branchForbidden&&url.endsWith('/protection')?403:200,
   headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(body)};
 };
 return createR181GithubPolicyInspector({fetcher,token:'fake-test-token',
  runId,commit,actorId,reviewerIds,clock,allowNetwork:true});
}
function aws({missingLock=false,badBytes=false,badKms=false,
  wrongStatus=false,stale=false,wrongIdentity=false,missingRead=false}={}){
 const executeAws=async({profile:p,service,operation,params})=>{
  const source=p===profile.source.profile,
   spec=source?profile.source:profile.offsite,
   version=source?sourceVersionId:offsiteVersionId;
  assert.ok(p===profile.source.profile||p===profile.offsite.profile);
  if(service==='sts')return{json:{
   Account:wrongIdentity?'000000000000':spec.accountId,
   Arn:'arn:aws:sts::'+spec.accountId+
    ':assumed-role/marcosa-r178-readonly-auditor/r181-ci',
   UserId:'AROA'+'A'.repeat(16)+':r181-ci'}};
  assert.equal(params.ExpectedBucketOwner,spec.accountId);
  assert.equal(params.Bucket,spec.bucket);
  switch(operation){
   case 'get-bucket-replication':return{json:{
    ReplicationConfiguration:{Role:'arn:aws:iam::'+profile.source.accountId+
     ':role/marcosa-staging-cross-account-replication',
     Rules:[{Status:'Enabled',
      Filter:{Prefix:'marcosa/isolated/r178/archive/'},
      DeleteMarkerReplication:{Status:'Disabled'},
      Destination:{Bucket:'arn:aws:s3:::'+profile.offsite.bucket,
       Account:profile.offsite.accountId}}]}}};
   case 'get-bucket-versioning':return{json:{Status:'Enabled'}};
   case 'get-object-lock-configuration':return{json:{
    ObjectLockConfiguration:{ObjectLockEnabled:'Enabled'}}};
   case 'get-public-access-block':return{json:{
    PublicAccessBlockConfiguration:{
     BlockPublicAcls:true,IgnorePublicAcls:true,
     BlockPublicPolicy:true,RestrictPublicBuckets:true}}};
   case 'head-object':return{json:{VersionId:version,
    ReplicationStatus:wrongStatus?'PENDING':source?'COMPLETED':'REPLICA',
    ContentLength:bytes.length,ChecksumSHA256:
     Buffer.from(objectSha256,'hex').toString('base64'),
    ContentType:'application/vnd.marcosa.r178-encrypted-archive',
    ServerSideEncryption:'aws:kms',
    SSEKMSKeyId:badKms?'bad':spec.kmsKeyArn,
    ObjectLockMode:missingLock?'GOVERNANCE':'COMPLIANCE',
    Metadata:{'marcosa-commit':commit,
     'marcosa-bundle-sha256':bundleSha256,
     'marcosa-history-root-sha256':historyRootSha256}}};
   case 'get-object-retention':return{json:{Retention:{
    Mode:'COMPLIANCE',RetainUntilDate:
     new Date(now+(stale?1:8)*86400000).toISOString()}}};
   case 'get-object':if(missingRead)throw Error('403');
    return{json:{VersionId:version,ContentLength:bytes.length},
     bytes:badBytes?Buffer.alloc(bytes.length,0xff):Buffer.from(bytes)};
   default:throw Error('mutation forbidden');
  }
 };
 return createR181AwsReadOnlyProbe({source:profile.source,
  offsite:profile.offsite,executeAws,clock,allowNetwork:true});
}
const hold={runId,sequence:3,nonce:'d'.repeat(32),sourceCommit:commit,
 classificationSha256:'e'.repeat(64),
 quorumReceiptSha256:'f'.repeat(64),
 decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING',productionAuthorized:false};
function gate({race=false,open=false,badGH=false,badAWS=false,
 sourceMode='CI_SYNTHETIC'}={}){
 let reads=0,quarantineReads=0;
 const g=createR181StagingEvaluator({readR180Hold:async()=>{
  reads++;return race&&reads>1?{...hold,sequence:4}:hold;},
  quarantine:{status:async()=>{
   quarantineReads++;return{closed:!open,generation:5};}},
  githubInspector:github({onlyOne:badGH}),
  awsInspector:aws({badBytes:badAWS}),
  clock,allowInspect:true});
 return g.inspect({...args,sourceMode});
}
test('R181 GH read-only live environment requires two ACTUAL approval events and protected branch',async()=>{
 const r=await github().inspect();
 assert.equal(r.twoDistinctReviewEventsShapeMatched,true);
 assert.equal(r.providerIdentityIndependentlyAuthenticated,false);
 assert.equal(r.productionAuthorized,false);
 for(const options of [{self:true},{onlyOne:true},{unprotected:true},
  {branchForbidden:true},{pending:true},{changedSha:true},
  {badRule:true},{duplicate:true}])
 await assert.rejects(github(options).inspect(),/R181 GitHub policy/,
  JSON.stringify(options));
});
test('R181 AWS profiles inspect both STS identities, exact S3 versions and application AES-GCM bytes',async()=>{
 const r=await aws().inspect(args);
 assert.equal(r.fullTwoAccountVersionReadbackShapeMatched,true);
 assert.equal(r.applicationEncryptedBytes,bytes.length);
 assert.equal(r.independentProviderAttestation,false);
 assert.equal(r.productionAuthorized,false);
 for(const options of [{missingLock:true},{badBytes:true},
  {badKms:true},{wrongStatus:true},{stale:true},
  {wrongIdentity:true},{missingRead:true}])
 await assert.rejects(aws(options).inspect(args),/R181 AWS read-only/,
  JSON.stringify(options));
 await assert.rejects(createR181AwsCliExecutor()({
  profile:'safe',region:'eu-west-1',service:'s3api',
  operation:'put-object',params:{} }),/R181 AWS read-only/);
});
test('R181 read-only evaluator never allows pilot, production or quarantine reopening',async()=>{
 const a=await gate({});
 assert.equal(a.decision,'NO_GO_PROVIDER_ATTESTATION_PENDING');
 assert.equal(a.sourceMode,'CI_SYNTHETIC');
 assert.equal(a.quarantineRemainsClosed,true);
 assert.equal(a.productionAuthorized,false);
 assert.match(a.evidenceSha256,/^[a-f0-9]{64}$/);
 for(const opt of [{race:true},{open:true},{badGH:true},{badAWS:true}])
 await assert.rejects(gate(opt),/R181 staging evaluator|R181 GitHub policy|R181 AWS read-only/);
 const manual=await gate({sourceMode:'MANUAL_READONLY'});
 assert.equal(manual.productionAuthorized,false);
});
test('R181 PostgreSQL serializable evidence joins exact R180 hold and denies replay',async()=>{
 const e=await gate({});
 const query=r181ObservationSql(e);
 for(const token of ['SERIALIZABLE','marcosa_r181_writer',
  'r180_ci.holds','r180_ci.hold_audit',
  'ON CONFLICT DO NOTHING','r181_ci.observation_audit'])
  assert.ok(query.includes(token),token);
 for(const patch of [{decision:'STAGING_GO'},
  {productionAuthorized:true},{nonce:"' OR 1=1"},
  {githubEvidenceSha256:'bad'},{
   sourceAccountId:profile.offsite.accountId
  }])
 assert.throws(()=>r181ObservationSql({...e,...patch}),
  /R181 observation ledger/);
 let n=0;
 const ledger=createR181ObservationLedger({
  executeSql:async()=>n++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'
 });
 assert.equal((await ledger.record(e)).recorded,true);
 await assert.rejects(ledger.record(e),/R181 observation ledger/);
 await assert.rejects(createR181ObservationLedger({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).record(e),/R181 observation ledger/);
});
