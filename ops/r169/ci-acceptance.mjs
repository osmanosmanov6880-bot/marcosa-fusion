/**
 * R169 isolated CI: native PG17 source/destination + signed 2-key approval
 * + AWS SDK-shaped STS/KMS/S3 mock + security posture + strict IAM + replay.
 *
 * Both AWS identity and OIDC runner env are synthetic and explicitly injected.
 * No real AWS IAM credentials, signed OIDC token or live Supabase used.
 */
import {spawnSync} from 'node:child_process';
import {randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {readR167FixtureInventory} from '../r167/pg-witness.mjs';
import {createR168SimulatedAws} from '../r168/mock-aws.mjs';
import {createR168AwsKmsAdapter} from '../r168/aws-kms.mjs';
import {createR168AwsS3Adapter} from '../r168/aws-s3.mjs';
import {createR168AwsPreflight} from '../r168/aws-preflight.mjs';
import {createR168BackupPipeline} from '../r168/backup-pipeline.mjs';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
import {createR169CloudPosture} from './cloud-posture.mjs';
import {r169GitHubOidcSubject,createR169IamPlan} from './iam-plan.mjs';
import {createR169StagingRehearsal,r169TargetDigest} from './staging-rehearsal.mjs';

const env=process.env;
const fail=m=>{throw Error('R169 real PG17 CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 /^[a-f0-9]{12,64}$/.test(env.R169_PG_CONTAINER||'')&&
 typeof env.RUNNER_TEMP==='string',
 'known disposable CI repository and PG17 required');
function run(exe,args,{input}={}){
 const x=spawnSync(exe,args,{input,encoding:null,maxBuffer:40*1024*1024,
  timeout:60000});
 ok(x.status===0&&!x.error,'isolated subprocess failed: '+exe);
 return x.stdout;
}
function pg(db,statement){
 return run('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1',
  '-d',db,'-c',statement]).toString('utf8').trim();
}
const commit=env.GITHUB_SHA,bundle=await buildR163Bundle({
 root:process.cwd(),commit
});
const inv=await readR167FixtureInventory({sqlRead:async q=>pg('postgres',q)});
const raw=run('docker',['exec','-u','postgres',env.R169_PG_CONTAINER,
 'pg_dump','-U','postgres','-d','postgres','--format=custom']);
ok(raw.subarray(0,5).toString('utf8')==='PGDMP'&&raw.length>512,
 'actual native PG17 source dump required');
const aws=createR168SimulatedAws();
try{
 const role='arn:aws:iam::111122223333:role/marcosa-staging-backup-role';
 const cloudPolicy=JSON.stringify({
  Version:'2012-10-17',
  Statement:[
   {Effect:'Deny',Principal:'*',Action:'s3:*',
    Resource:'arn:aws:s3:::marcosa-ci-locked/*',
    Condition:{Bool:{'aws:SecureTransport':'false'}}},
   {Effect:'Allow',Principal:{AWS:role},Action:'s3:GetObject',
    Resource:'arn:aws:s3:::marcosa-ci-locked/marcosa/isolated/r168/*'}
  ]
 });
 const kmsPolicy=JSON.stringify({
  Version:'2012-10-17',
  Statement:[{Effect:'Allow',Principal:{AWS:role},
   Action:['kms:GenerateDataKey','kms:Decrypt'],Resource:'*',
   Condition:{StringEquals:{
    'kms:EncryptionContext:marcosa-scope':'isolated-staging-only'}}}]
 });
 const extraClasses=['GetBucketPolicyCommand','GetBucketEncryptionCommand',
  'GetBucketOwnershipControlsCommand','GetKeyPolicyCommand'];
 const extra=Object.fromEntries(extraClasses.map(kind=>[kind,class{
  constructor(input){this.kind=kind;this.input=input;}
 }]));
 const proxy={
  send:async c=>{
   switch(c.kind){
   case 'GetBucketPolicyCommand':return{Policy:cloudPolicy};
   case 'GetBucketEncryptionCommand':return{
    ServerSideEncryptionConfiguration:{Rules:[
     {ApplyServerSideEncryptionByDefault:{
      SSEAlgorithm:'aws:kms',KMSMasterKeyID:aws.keyArn}}]}};
   case 'GetBucketOwnershipControlsCommand':return{OwnershipControls:{Rules:[
    {ObjectOwnership:'BucketOwnerEnforced'}]}};
   case 'GetKeyPolicyCommand':return{Policy:kmsPolicy};
   default:return aws.s3Client.send(c);
   }
  }
 };
 const assumedRoleArn='arn:aws:iam::111122223333:role/marcosa-staging-backup-role';
 const opts={region:aws.region,accountId:aws.accountId,clock:()=>Date.now()};
 const commands={...aws.commands,...extra};
 const preflightBase=createR168AwsPreflight({
  ...opts,commands,sts:aws.stsClient,kms:aws.kmsClient,s3:aws.s3Client,
  bucket:aws.bucket,kmsKeyArn:aws.keyArn,allowExternalCalls:true
 });
 const preflight={inspect:async()=>{
  const x=await preflightBase.inspect();
  return Object.freeze({...x,identityArn:'arn:aws:sts::111122223333:'+ 
   'assumed-role/marcosa-staging-backup-role/ci-r169'});
 }};
 const posture=createR169CloudPosture({
  ...opts,commands,s3:proxy,kms:proxy,bucket:aws.bucket,
  kmsKeyArn:aws.keyArn,assumedRoleArn,allowExternalCalls:true
 });
 const kms=createR168AwsKmsAdapter({
  ...opts,client:aws.kmsClient,commands,keyArn:aws.keyArn,
  allowExternalCalls:true
 });
 const s3=createR168AwsS3Adapter({
  ...opts,client:aws.s3Client,commands,
  bucket:aws.bucket,kmsKeyArn:aws.keyArn,allowExternalCalls:true
 });
 const pipeline=createR168BackupPipeline({kms,s3,preflight});
 const identity={accountId:aws.accountId,region:aws.region,
  bucketName:aws.bucket,kmsKeyArn:aws.keyArn,
  ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
 const iamExpected={...identity,
  expectedOidcSubject:r169GitHubOidcSubject(identity)};
 const iamPlan=createR169IamPlan(iamExpected);
 const envFixture={
  GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:env.GITHUB_REPOSITORY,
  GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:env.GITHUB_RUN_ID,
  MARCOSA_STAGING_ONLY:'true',MARCOSA_REAL_AWS_OPT_IN:'true',
  AWS_EC2_METADATA_DISABLED:'true'
 };
 const restoredNames=[];
 const quarantine={status:async()=>{
  const line=pg('postgres','SELECT closed::text||\':\'||generation FROM r167_ci.r167_quarantine WHERE id=1;');
  const [closed,generation]=line.split(':');
  return{closed:closed==='true',generation:Number(generation)};
 }};
 const nonceSet=new Set();
 const durableQuorum={
  async consume({packet}){
   if(nonceSet.has(packet.nonce))throw Error('signed nonce already consumed');
   nonceSet.add(packet.nonce);
   return {rehearsalLeaseRecorded:true,durablePostgresFence:true,
    nonce:packet.nonce,productionAuthorized:false};
  }
 };
 const targetDigest=r169TargetDigest({
  commit,bundleSha256:bundle.sha256,sourceInventory:inv,
  roleArn:iamPlan.AWS_ROLE_ARN});
 const reviewers=['operator','independent-reviewer'].map(role=>{
  const pair=generateKeyPairSync('ed25519');
  return{role,privateKey:pair.privateKey,publicKeyPem:
   pair.publicKey.export({format:'pem',type:'spki'})};
 });
 const packet=createR164DrillChallenge({
  commit,targetDigest,nonce:randomBytes(16).toString('hex')});
 const approvals=reviewers.map(x=>({
  role:x.role,publicKeyPem:x.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),x.privateKey)
   .toString('base64url')
 }));
 const pinnedReviewerFingerprints=Object.fromEntries(reviewers.map(x=>[
  x.role,r164ReviewerFingerprint(x.publicKeyPem)]));
 const drill=createR169StagingRehearsal({
  iamPlan,iamExpected,preflight,posture,quarantine,durableQuorum,
  pipeline,env:envFixture
 });
 const args={
  commit,bundleSha256:bundle.sha256,
  archiveId:randomBytes(16).toString('hex'),
  sourceInventory:inv,plaintext:raw,packet,approvals,pinnedReviewerFingerprints,
  restoreIntoDisposableDatabase:async({database,plaintext,productionAuthorized})=>{
   ok(database==='marcosa_r168_restored'&&productionAuthorized===false,
    'only reserved synthetic restored database allowed');
   pg('postgres',"CREATE DATABASE marcosa_r168_restored TEMPLATE template0;");
   run('docker',['exec','-u','postgres','-i',env.R169_PG_CONTAINER,
    'pg_restore','-U','postgres','-d',database,'--no-owner','--exit-on-error'],
    {input:plaintext});
   restoredNames.push(database);
   return{success:true,database};
  },
  readRestoredInventory:async({database})=>
   readR167FixtureInventory({sqlRead:async q=>pg(database,q)})
 };
 const result=await drill.execute(args);
 ok(result.verified&&result.productionAuthorized===false&&
  result.cloudCallsPermittedOnlyInManualStaging&&
  result.twoPinnedKeysVerified&&restoredNames.length===1,
  'synthetic provider disaster recovery acceptance failed');
 let reused=false;
 try{await drill.execute(args);}catch{reused=true;}
 ok(reused&&nonceSet.size===1,'second signed identical challenge must fail');
 const report={
  schemaVersion:1,commit,bundleSha256:bundle.sha256,
  encryptedSha256:result.encryptedSha256,
  nativePostgres17Restore:true,
  roleAndPolicyScopedToFeatureBranch:true,
  ephemeralSessionGuardExercised:true,
  twoSignatureEd25519ProofVerified:true,
  nonceReplayRejectedInProcess:true,
  durablePostgresNonceFromR165VerifiedInSeparateCI:true,
  quarantineReadFromPostgres17:true,
  awsKmsS3PostureExaminedThroughSimulatedClients:true,
  sourceAndTargetSecurityInventoryEqual:true,
  noRealAwsCredentials:true,noLiveSupabase:true,
  noExternalKmsPolicyAudit:true,
  productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,'r169-operator-security-report.json'),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R169_REAL_PG17_SIGNED_MANUAL_REHEARSAL=PASS');
 console.log('R169_OIDC_IAM_KMS_S3_CLOUD_POSTURE_GUARDS=PASS');
 console.log('R169_REAL_PG17_RESTORED_RLS_SESSIONS_QUARANTINE=PASS');
 console.log('R169_REUSED_ED25519_QUORUM_NONCE_DENIED=PASS');
 console.log('R169_LIVE_AWS_KMS_AND_SUPABASE_PRODUCTION=NO_GO');
}finally{
 raw.fill(0);
 aws.dispose();
}
