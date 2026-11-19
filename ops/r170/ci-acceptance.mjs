/**
 * R170 disposable PG17 + genuine AWS SDK class integration (NO network).
 * Run mode: original postgres:17-alpine PGDMP + synthetic AWS R168 encrypted
 * storage + full R170 OIDC/IAM/retention gate + PostgreSQL nonce replay.
 * Verify mode: separate runner with zero credentials and exact source hash.
 * NO external AWS calls, real IAM audits or customer information.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {readR167FixtureInventory} from '../r167/pg-witness.mjs';
import {createR168SimulatedAws} from '../r168/mock-aws.mjs';
import {createR168AwsKmsAdapter} from '../r168/aws-kms.mjs';
import {createR168AwsS3Adapter} from '../r168/aws-s3.mjs';
import {createR168AwsPreflight} from '../r168/aws-preflight.mjs';
import {createR168BackupPipeline} from '../r168/backup-pipeline.mjs';
import {createR169CloudPosture} from '../r169/cloud-posture.mjs';
import {createR169IamPlan,r169GitHubOidcSubject} from '../r169/iam-plan.mjs';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
import {createR170OidcStsExchange} from './oidc-sts.mjs';
import {createR170IamSimulator} from './iam-simulator.mjs';
import {createR170S3RetentionWitness} from './s3-retention.mjs';
import {createR170ReadOnlyStage,r170StageTargetDigest} from './read-only-stage.mjs';
const env=process.env;
const fail=m=>{throw Error('R170 CI acceptance: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha40=/^[0-9a-f]{40}$/,sha64=/^[0-9a-f]{64}$/;
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 sha40.test(env.GITHUB_SHA||'')&&typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&!env.AWS_SESSION_TOKEN,
 'only no-credential isolated GitHub CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const reportName='r170-safe-isolated-evidence.json';
if(env.R170_SECOND_PASS==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,
  'second runner cannot receive PostgreSQL credentials');
 const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r170-second-evidence',reportName),'utf8'));
 const names=['schemaVersion','commit','sourceBundleSha256',
  'encryptedSha256','publishedNativeAwsSdkV3Commands',
  'nativePostgres17EncryptedBackupRestore',
  'sourceRestoreRlsAndRevocationsMatched',
  'oidcStsTokenSourceAndResponseContract',
  'readOnlyIamSimulations','readOnlyS3ObjectLockVersionReadback',
  'signedTwoKeys','persistentPostgresNonceReplayRejected',
  'offsiteAwsActuallyContacted','awsIamEffectiveRightsIndependentlyVerified',
  'githubRealIdTokenIssued','humanReviewerSeparationProven',
  'liveSupabaseChanged','productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===names&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256&&
  sha64.test(report.encryptedSha256||''),
  'independent source hash and exact safe report required');
 for(const name of [
  'publishedNativeAwsSdkV3Commands','nativePostgres17EncryptedBackupRestore',
  'sourceRestoreRlsAndRevocationsMatched',
  'oidcStsTokenSourceAndResponseContract','signedTwoKeys',
  'persistentPostgresNonceReplayRejected'
 ])ok(report[name]===true,'missing simulated provider / real PG proof');
 ok(report.readOnlyIamSimulations===13&&
  report.readOnlyS3ObjectLockVersionReadback===true,
  'missing read-only cloud canaries');
 for(const name of [
  'offsiteAwsActuallyContacted','awsIamEffectiveRightsIndependentlyVerified',
  'githubRealIdTokenIssued','humanReviewerSeparationProven',
  'liveSupabaseChanged','productionAuthorized'
 ])ok(report[name]===false,'false real-world authorization claim: '+name);
 console.log('R170_SECOND_RUNNER_SOURCE_AND_REPORT_INTEGRITY=PASS');
 console.log('R170_NO_EXTERNAL_AWS_OR_PRODUCTION_AUTHORITY=PASS');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R170_PG_CONTAINER||'')&&
  typeof env.GITHUB_RUN_ID==='string'&&/^[0-9]{5,20}$/.test(env.GITHUB_RUN_ID),
  'disposable postgres:17-alpine source only');
 function run(exe,args,{input}={}){
  const p=spawnSync(exe,args,{input,encoding:null,
   timeout:60000,maxBuffer:40*1024*1024});
  ok(p.status===0&&!p.error,'PostgreSQL native command failed');
  return p.stdout;
 }
 const pg=(database,sql)=>run('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',database,'-c',sql]).toString('utf8').trim();
 const [kmsModule,s3Module,stsModule,iamModule]=await Promise.all([
  import('@aws-sdk/client-kms'),import('@aws-sdk/client-s3'),
  import('@aws-sdk/client-sts'),import('@aws-sdk/client-iam')
 ]);
 ok(['GenerateDataKeyCommand','DecryptCommand'].every(
  k=>typeof kmsModule[k]==='function')&&
  ['GetObjectRetentionCommand','GetObjectAttributesCommand'].every(
  k=>typeof s3Module[k]==='function')&&
  typeof stsModule.AssumeRoleWithWebIdentityCommand==='function'&&
  typeof iamModule.SimulatePrincipalPolicyCommand==='function',
  'actual published AWS SDK v3 command classes not installed');
 const sourceInventory=await readR167FixtureInventory({
  sqlRead:async q=>pg('postgres',q)
 });
 const raw=run('docker',['exec','-u','postgres',env.R170_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','--format=custom']);
 ok(raw.length>512&&raw.subarray(0,5).toString('utf8')==='PGDMP',
  'native disposable PG17 dump required');
 const aws=createR168SimulatedAws();
 try{
  const now=Date.now(),clock=()=>now;
  const {accountId,region,bucket:bucketName,keyArn:kmsKeyArn}=aws;
  const sourceCommit=commit,archiveId=randomBytes(16).toString('hex');
  const roleName='marcosa-staging-backup-role';
  const iamExpected={accountId,region,bucketName,kmsKeyArn,
   ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
  iamExpected.expectedOidcSubject=r169GitHubOidcSubject(iamExpected);
  const iamPlan=createR169IamPlan(iamExpected);
  const authEnv={
   GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:env.GITHUB_REPOSITORY,
   GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
   GITHUB_SHA:commit,GITHUB_EVENT_NAME:'workflow_dispatch',
   GITHUB_RUN_ID:env.GITHUB_RUN_ID,MARCOSA_STAGING_ONLY:'true',
   MARCOSA_REAL_AWS_OPT_IN:'true',AWS_EC2_METADATA_DISABLED:'true'
  };
  const session='marcosa-r170-'+env.GITHUB_RUN_ID;
  const sessionArn='arn:aws:sts::'+accountId+
   ':assumed-role/'+roleName+'/'+session;
  const issuer=r169GitHubOidcSubject(iamExpected);
  const stamp=Math.floor(now/1000);
  const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const idToken=b64({alg:'RS256',typ:'JWT'})+'.'+b64({
   iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',
   sub:issuer,repository:'osmanosmanov6880-bot/marcosa-fusion',
   ref:authEnv.GITHUB_REF,sha:commit,
   repository_id:'1430301644',repository_owner_id:'340648536',
   iat:stamp-10,exp:stamp+300
  })+'.'+'A'.repeat(86);
  const sts={send:async cmd=>{
   ok(cmd.constructor.name==='AssumeRoleWithWebIdentityCommand'&&
    cmd.input.DurationSeconds===900&&
    cmd.input.RoleArn===iamPlan.AWS_ROLE_ARN,
    'synthetic STS client saw unexpected request');
   return{Audience:'sts.amazonaws.com',
    SubjectFromWebIdentityToken:issuer,
    Provider:'token.actions.githubusercontent.com',
    AssumedRoleUser:{Arn:sessionArn},
    Credentials:{AccessKeyId:'ASIA'+'A'.repeat(16),
     SecretAccessKey:'B'.repeat(40),
     SessionToken:'ci-only-'+ 'x'.repeat(70),
     Expiration:new Date(now+900000)}};
  }};
  const oidcExchange=createR170OidcStsExchange({
   sts,commands:{AssumeRoleWithWebIdentityCommand:
    stsModule.AssumeRoleWithWebIdentityCommand},
   roleArn:iamPlan.AWS_ROLE_ARN,region,ownerId:iamExpected.ownerId,
   repoId:iamExpected.repoId,subjectMode:'legacy',env:authEnv,
   clock,allowExternalCalls:true
  });
  const opts={accountId,region,clock,allowExternalCalls:true};
  const backupPreflight=createR168AwsPreflight({
   ...opts,sts:aws.stsClient,kms:aws.kmsClient,s3:aws.s3Client,
   commands:aws.commands,bucket:bucketName,kmsKeyArn
  });
  const kms=createR168AwsKmsAdapter({
   ...opts,client:aws.kmsClient,commands:aws.commands,keyArn:kmsKeyArn
  });
  const s3=createR168AwsS3Adapter({
   ...opts,client:aws.s3Client,commands:aws.commands,bucket:bucketName,
   kmsKeyArn,retainDays:7
  });
  const pipe=createR168BackupPipeline({kms,s3,preflight:backupPreflight,clock});
  const saved=await pipe.backup({plaintext:raw,commit,
   bundleSha256:bundle.sha256,archiveId,sourceInventory
  });
  ok(saved.remoteReceiptVerified===true&&
   saved.reference.encryptedSha256.length===64,
   'real PG17 encrypted source backup absent');
  const restored=await pipe.rehearseRecovery({
   reference:saved.reference,sourceInventory,
   pinnedInventorySha256:saved.reference.inventorySha256,
   restoreIntoDisposableDatabase:async({database,plaintext,
    productionAuthorized})=>{
    ok(database==='marcosa_r168_restored'&&productionAuthorized===false,
     'no nonisolated recovery target');
    pg('postgres','CREATE DATABASE marcosa_r168_restored TEMPLATE template0;');
    run('docker',['exec','-u','postgres','-i',env.R170_PG_CONTAINER,
     'pg_restore','-U','postgres','-d',database,'--no-owner',
     '--exit-on-error'],{input:plaintext});
    return{success:true,database};
   },
   readRestoredInventory:async({database})=>
    readR167FixtureInventory({sqlRead:async q=>pg(database,q)})
  });
  ok(restored.verified&&restored.independentSqlWitnessVerified,
   'native PostgreSQL restore or independent RLS witness failed');
  const reference={
   sha256:saved.reference.encryptedSha256,
   versionId:saved.reference.versionId,
   archiveId,contextSha256:saved.reference.contextSha256,
   commit,bundleSha256:bundle.sha256
  };
  // Native official IAM SDK input, with a mock evaluator acting only on
  // the fixed canary cases. Its decision is never real AWS authorization.
  const iamAdapter={send:async command=>{
   ok(command.constructor.name==='SimulatePrincipalPolicyCommand',
    'genuine IAM v3 simulation command class required');
   const i=command.input,action=i.ActionNames?.[0],resource=i.ResourceArns?.[0];
   const negative=['s3:DeleteObjectVersion',
    's3:BypassGovernanceRetention','s3:PutBucketPolicy',
    'kms:ScheduleKeyDeletion'].includes(action)||
    resource.includes('/marcosa/production/')||
    i.ContextEntries?.some(entry=>
     entry.ContextKeyValues.includes('production'));
   const decision=negative?'explicitDeny':'allowed';
   return{IsTruncated:false,
    EvaluationResults:[{EvalActionName:action,EvalResourceName:resource,
     EvalDecision:decision,MissingContextValues:[],
     ResourceSpecificResults:[{EvalResourceName:resource,
      EvalResourceDecision:decision}],
     PermissionsBoundaryDecisionDetail:{AllowedByPermissionsBoundary:true},
     OrganizationsDecisionDetail:{AllowedByOrganizations:true}}]};
  }};
  const simulator=createR170IamSimulator({
   client:iamAdapter,commands:{
    SimulatePrincipalPolicyCommand:iamModule.SimulatePrincipalPolicyCommand
   },accountId,bucket:bucketName,kmsKeyArn,
   archiveSha256:reference.sha256,allowExternalCalls:true,clock
  });
  const extra={
   GetObjectRetentionCommand:s3Module.GetObjectRetentionCommand,
   GetObjectAttributesCommand:s3Module.GetObjectAttributesCommand
  };
  const s3Readonly={
   send:async command=>{
    ok(['GetObjectRetentionCommand','GetObjectAttributesCommand']
     .includes(command.constructor.name),
     'unrecognised S3 read-only command');
    const i=command.input,head=await aws.s3Client.send(
     new aws.commands.HeadObjectCommand({
      Bucket:bucketName,Key:i.Key,VersionId:i.VersionId
     }));
    if(command.constructor.name==='GetObjectRetentionCommand'){
     return{Retention:{Mode:head.ObjectLockMode,
      RetainUntilDate:head.ObjectLockRetainUntilDate}};
    }
    return{VersionId:head.VersionId,ObjectSize:head.ContentLength,
     Checksum:{ChecksumSHA256:head.ChecksumSHA256}};
   }
  };
  const witness=createR170S3RetentionWitness({
   client:s3Readonly,commands:extra,s3,
   accountId,bucket:bucketName,kmsKeyArn,
   allowExternalCalls:true,clock
  });
  const roleArn='arn:aws:iam::'+accountId+':role/'+roleName;
  const readOnlyPolicy=JSON.stringify({
   Version:'2012-10-17',Statement:[
    {Effect:'Deny',Principal:'*',Action:'s3:*',
     Resource:'arn:aws:s3:::'+bucketName+'/*',
     Condition:{Bool:{'aws:SecureTransport':'false'}}},
    {Effect:'Allow',Principal:{AWS:roleArn},Action:'s3:GetObject',
     Resource:'arn:aws:s3:::'+bucketName+'/marcosa/isolated/r168/*'}
   ]
  });
  const keyPolicy=JSON.stringify({Version:'2012-10-17',
   Statement:[{Effect:'Allow',Principal:{AWS:roleArn},
    Action:['kms:GenerateDataKey','kms:Decrypt'],Resource:'*',
    Condition:{StringEquals:{
     'kms:EncryptionContext:marcosa-scope':'isolated-staging-only'}}}]
  });
  const postClient={send:async cmd=>{
   switch(cmd.kind){
   case 'GetBucketPolicyCommand':return{Policy:readOnlyPolicy};
   case 'GetBucketEncryptionCommand':return{
    ServerSideEncryptionConfiguration:{Rules:[
     {ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'aws:kms',
      KMSMasterKeyID:kmsKeyArn}}]}};
   case 'GetBucketOwnershipControlsCommand':return{
    OwnershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]}};
   case 'GetKeyPolicyCommand':return{Policy:keyPolicy};
   default:throw Error('Unknown posture command');
   }
  }};
  const postNames=['GetBucketPolicyCommand','GetBucketEncryptionCommand',
   'GetBucketOwnershipControlsCommand','GetKeyPolicyCommand'];
  const postCommands=Object.fromEntries(postNames.map(kind=>
   [kind,class{constructor(input){this.kind=kind;this.input=input;}}]));
  const posture=createR169CloudPosture({
   s3:postClient,kms:postClient,commands:postCommands,
   accountId,region,bucket:bucketName,kmsKeyArn,assumedRoleArn:roleArn,
   allowExternalCalls:true,clock
  });
  let closed=0;
  const runtimeFactory=async({credentials})=>{
   ok(credentials.accessKeyId==='ASIA'+'A'.repeat(16),
    'runtime not STS session scoped');
   return{
    preflight:{inspect:async()=>({
     ...await backupPreflight.inspect(),identityArn:sessionArn
    })},posture,iam:simulator,retention:witness,
    close:async()=>{closed++;}
   };
  };
  // Test-only SQL primary key is a real durable PostgreSQL conflict fence.
  pg('postgres','CREATE TABLE r167_ci.r170_nonce_fence (nonce text PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now());');
  pg('postgres','ALTER TABLE r167_ci.r170_nonce_fence ENABLE ROW LEVEL SECURITY;');
  pg('postgres','REVOKE ALL ON r167_ci.r170_nonce_fence FROM PUBLIC,anon,authenticated;');
  const quarantine={status:async()=>{
   const line=pg('postgres',
    "SELECT closed::text||':'||generation::text FROM r167_ci.r167_quarantine WHERE id=1;");
   const [closed,generation]=line.split(':');
   return{closed:closed==='true',generation:Number(generation)};
  }};
  const durableQuorum={consume:async({packet})=>{
   const nonce=packet?.nonce;
   ok(typeof nonce==='string'&&/^[a-f0-9]{32}$/.test(nonce),
    'durable SQL nonce encoding');
   const result=pg('postgres',"INSERT INTO r167_ci.r170_nonce_fence(nonce) VALUES('"+
    nonce+"') ON CONFLICT DO NOTHING RETURNING nonce;");
   if(result!==nonce)throw Error('signed nonce previously committed');
   return{rehearsalLeaseRecorded:true,durablePostgresFence:true,
    nonce,productionAuthorized:false};
  }};
  const role=iamPlan.AWS_ROLE_ARN;
  const targetDigest=r170StageTargetDigest({
   commit,bundleSha256:bundle.sha256,roleArn:role,
   reference,inventorySha256:saved.reference.inventorySha256
  });
  const packet=createR164DrillChallenge({commit,targetDigest,
   nonce:randomBytes(16).toString('hex'),clock});
  const reviewers=['operator','independent-reviewer'].map(role=>{
   const key=generateKeyPairSync('ed25519');
   return{role,privateKey:key.privateKey,publicKeyPem:key.publicKey.export({
    type:'spki',format:'pem'})};
  });
  const approvals=reviewers.map(k=>({
   role:k.role,publicKeyPem:k.publicKeyPem,
   signature:sign(null,r164CanonicalChallengeBytes(packet),k.privateKey)
    .toString('base64url')
  }));
  const pinnedReviewerFingerprints=Object.fromEntries(reviewers.map(k=>[
   k.role,r164ReviewerFingerprint(k.publicKeyPem)]));
  const stage=createR170ReadOnlyStage({
   oidcExchange,iamPlan,iamExpected,
   runtimeFactory,quarantine,durableQuorum,env:authEnv,clock
  });
  const args={idToken,commit,bundleSha256:bundle.sha256,
   reference,inventorySha256:saved.reference.inventorySha256,
   packet,approvals,pinnedReviewerFingerprints};
  const receipt=await stage.verify(args);
  ok(receipt.verified===true&&receipt.iamCanariesPassed===13&&
   receipt.productionAuthorized===false&&closed===1,
   'full read-only stage verification rejected');
  let duplicateDenied=false;
  try{await stage.verify(args);}catch{duplicateDenied=true;}
  ok(duplicateDenied&&closed===2,'Postgres SQL nonce replay not denied');
  const count=pg('postgres',
   'SELECT count(*)::integer FROM r167_ci.r170_nonce_fence;');
  ok(count==='1','exactly one durable PostgreSQL nonce required');
  let iamDenyDetected=false,lockDowngradeDetected=false;
  const hostileIam=createR170IamSimulator({
   client:{send:async()=>({IsTruncated:false,EvaluationResults:[]})},
   commands:{SimulatePrincipalPolicyCommand:iamModule.SimulatePrincipalPolicyCommand},
   accountId,bucket:bucketName,kmsKeyArn,
   archiveSha256:reference.sha256,allowExternalCalls:true,clock
  });
  try{await hostileIam.inspect();}catch{iamDenyDetected=true;}
  aws.alter({governance:true});
  try{await witness.inspect(args.reference);}catch{lockDowngradeDetected=true;}
  aws.alter({governance:false});
  ok(iamDenyDetected&&lockDowngradeDetected,
   'IAM unverified response or retention downgrade not rejected');
  const report={
   schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
   encryptedSha256:reference.sha256,
   publishedNativeAwsSdkV3Commands:true,
   nativePostgres17EncryptedBackupRestore:true,
   sourceRestoreRlsAndRevocationsMatched:true,
   oidcStsTokenSourceAndResponseContract:true,
   readOnlyIamSimulations:13,
   readOnlyS3ObjectLockVersionReadback:true,
   signedTwoKeys:true,
   persistentPostgresNonceReplayRejected:true,
   offsiteAwsActuallyContacted:false,
   awsIamEffectiveRightsIndependentlyVerified:false,
   githubRealIdTokenIssued:false,humanReviewerSeparationProven:false,
   liveSupabaseChanged:false,productionAuthorized:false
  };
  await writeFile(join(env.RUNNER_TEMP,reportName),
   JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R170_GENUINE_AWS_SDK_V3_STS_IAM_S3_COMMANDS=PASS');
  console.log('R170_REAL_PG17_BACKUP_RESTORE_AND_RLS_SECURITY=PASS');
  console.log('R170_FULL_READONLY_OIDC_IAM_S3_SIGNED_STAGE=PASS');
  console.log('R170_POSTGRES_NONCE_REPLAY_AND_SECURITY_DOWNGRADE_REJECTED=PASS');
  console.log('R170_NO_REAL_AWS_OIDC_AUTHORIZATION_OR_PRODUCTION=PASS');
 }finally{raw.fill(0);aws.dispose();}
}
