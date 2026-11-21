/**
 * R171 two-runner disposable CI. Real PostgreSQL17 pg_dump/pg_restore/RLS,
 * official AWS SDK v3 classes; AWS provider responses and OIDC are synthetic.
 * No network to AWS, no customer data, no production grants.
 */
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {readR167FixtureInventory} from '../r167/pg-witness.mjs';
import {createR168SimulatedAws} from '../r168/mock-aws.mjs';
import {createR168AwsKmsAdapter} from '../r168/aws-kms.mjs';
import {createR168AwsS3Adapter} from '../r168/aws-s3.mjs';
import {createR168AwsPreflight} from '../r168/aws-preflight.mjs';
import {createR168BackupPipeline} from '../r168/backup-pipeline.mjs';
import {r169GitHubOidcSubject,createR169IamPlan} from '../r169/iam-plan.mjs';
import {createR170OidcStsExchange} from '../r170/oidc-sts.mjs';
import {createR170S3RetentionWitness} from '../r170/s3-retention.mjs';
import {createR171OidcTokenProvider} from './oidc-provider.mjs';
import {createR171IamRoleAudit} from './iam-role-audit.mjs';
import {createR171S3VersionAudit} from './s3-version-audit.mjs';
import {createR171PostgresFence} from './pg-fence.mjs';

const env=process.env,clock=()=>Date.now();
const fail=m=>{throw Error('R171 PG17 CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const digest=/^[a-f0-9]{64}$/;
const reportName='r171-safe-evidence.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'disposable no-cloud GitHub Actions required');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});

if(env.R171_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,'no PostgreSQL credentials in second runner');
 const data=JSON.parse(await readFile(join(env.RUNNER_TEMP,'r171-report',reportName),'utf8'));
 const keys=[
  'schemaVersion','commit','bundleSha256','encryptedSha256','archiveVersion',
  'realPostgreSQL17BackupRestore','realPostgresNonceUniqueAcrossProcesses',
  'realPostgresRlsAndAuditRestored','officialAwsSdkCommandClassesUsed',
  'mockGitHubOidcAndStsContract','mockIamRoleAndBoundaryExact',
  'mockS3ObjectVersionAndRetentionExact',
  'actualAwsAccountConnected','actualAwsIamEffectivePermissionsAudited',
  'actualGitHubOidcTokenIssued','actualHumanReviewVerified',
  'customerSupabaseModified','productionAuthorized'
 ].sort().join(',');
 ok(data&&Object.getPrototypeOf(data)===Object.prototype&&
  Object.keys(data).sort().join(',')===keys&&data.schemaVersion===1&&
  data.commit===commit&&data.bundleSha256===bundle.sha256&&
  digest.test(data.encryptedSha256||'')&&
  /^[A-Za-z0-9_.-]{1,128}$/.test(data.archiveVersion||''),
  'exact nonsecret source-bound evidence required');
 for(const name of [
  'realPostgreSQL17BackupRestore','realPostgresNonceUniqueAcrossProcesses',
  'realPostgresRlsAndAuditRestored','officialAwsSdkCommandClassesUsed',
  'mockGitHubOidcAndStsContract','mockIamRoleAndBoundaryExact',
  'mockS3ObjectVersionAndRetentionExact'
 ])ok(data[name]===true,'missing verified lab evidence '+name);
 for(const name of [
  'actualAwsAccountConnected','actualAwsIamEffectivePermissionsAudited',
  'actualGitHubOidcTokenIssued','actualHumanReviewVerified',
  'customerSupabaseModified','productionAuthorized'
 ])ok(data[name]===false,'false production/cloud authorization claim');
 console.log('R171_SECOND_RUNNER_EXACT_SHA_AND_NONPRODUCTION_EVIDENCE=PASS');
 console.log('R171_REAL_AWS_ACCOUNT_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R171_PG_CONTAINER||'')&&
  /^[0-9]{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'actual disposable PG17 source required');
 const exec=(file,args,{input}={})=>{
  const p=spawnSync(file,args,{input,encoding:null,
   timeout:60000,maxBuffer:40*1024*1024});
  ok(p.status===0&&!p.error,'native PG17 command failed');
  return p.stdout;
 };
 const sql=(db,q)=>exec('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',q]).toString('utf8').trim();
 const requireAws=createRequire(new URL('../r170/package.json',import.meta.url));
 const iamSdk=requireAws('@aws-sdk/client-iam');
 const s3Sdk=requireAws('@aws-sdk/client-s3');
 const stsSdk=requireAws('@aws-sdk/client-sts');
 ok(['GetRoleCommand','ListRolePoliciesCommand','GetRolePolicyCommand',
  'ListAttachedRolePoliciesCommand','GetPolicyCommand',
  'GetPolicyVersionCommand'].every(x=>typeof iamSdk[x]==='function')&&
  ['ListObjectVersionsCommand','GetObjectLegalHoldCommand',
   'GetBucketPolicyStatusCommand','GetObjectRetentionCommand',
   'GetObjectAttributesCommand'].every(x=>typeof s3Sdk[x]==='function')&&
  typeof stsSdk.AssumeRoleWithWebIdentityCommand==='function',
  'published IAM/S3/STS SDK v3 command classes required');
 const beforeInventory=await readR167FixtureInventory({
  sqlRead:async q=>sql('postgres',q)
 });
 const aws=createR168SimulatedAws({clock});
 const accountId=aws.accountId,bucket=aws.bucket,region=aws.region,
  kmsKeyArn=aws.keyArn,role='marcosa-staging-backup-role';
 const expected={accountId,region,bucketName:bucket,kmsKeyArn,
  ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
 expected.expectedOidcSubject=r169GitHubOidcSubject(expected);
 const plan=createR169IamPlan(expected);
 const boundary='arn:aws:iam::'+accountId+
  ':policy/marcosa-staging-deny-boundary';
 const encode=x=>encodeURIComponent(JSON.stringify(x));
 const iam={send:async cmd=>{
  if(cmd instanceof iamSdk.GetRoleCommand)return{Role:{
   Arn:plan.AWS_ROLE_ARN,RoleId:'AROA'+'A'.repeat(16),RoleName:role,
   Path:'/',MaxSessionDuration:3600,
   AssumeRolePolicyDocument:encode(plan.trustPolicy),
   PermissionsBoundary:{PermissionsBoundaryType:'PermissionsBoundary',
    PermissionsBoundaryArn:boundary}}};
  if(cmd instanceof iamSdk.ListRolePoliciesCommand)
   return{PolicyNames:['marcosa-staging-backup-inline'],IsTruncated:false};
  if(cmd instanceof iamSdk.ListAttachedRolePoliciesCommand)
   return{AttachedPolicies:[],IsTruncated:false};
  if(cmd instanceof iamSdk.GetRolePolicyCommand)
   return{RoleName:role,PolicyName:'marcosa-staging-backup-inline',
    PolicyDocument:encode(plan.permissionsPolicy)};
  if(cmd instanceof iamSdk.GetPolicyCommand)
   return{Policy:{Arn:boundary,DefaultVersionId:'v1',
    IsAttachable:true,AttachmentCount:1}};
  if(cmd instanceof iamSdk.GetPolicyVersionCommand)
   return{PolicyVersion:{IsDefaultVersion:true,
    Document:encode(plan.permissionsPolicy)}};
  throw Error('unapproved IAM command');
 }};
 const roleProof=await createR171IamRoleAudit({
  client:iam,commands:iamSdk,plan,boundaryArn:boundary,
  allowExternalCalls:true,clock
 }).inspect();
 ok(roleProof.checked&&roleProof.serviceEffectivePermissionsProven===false,
  'IAM role/permissions boundary fingerprint mismatch');
 const oidcEnv={
  GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:env.GITHUB_REPOSITORY,
  GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
  GITHUB_WORKFLOW_REF:env.GITHUB_REPOSITORY+
   '/.github/workflows/marcosa-r171-live-staging.yml@refs/heads/feature/marcosa-r150-growth-economics',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:env.GITHUB_RUN_ID,
  GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:commit,
  GITHUB_REPOSITORY_ID:'1430301644',
  GITHUB_REPOSITORY_OWNER_ID:'340648536',
  MARCOSA_AWS_STAGING_ENV:'marcosa-aws-staging',
  MARCOSA_AWS_STAGING_PROTECTION_CONFIRMED:'true',
  MARCOSA_REAL_AWS_OPT_IN:'true',
  MARCOSA_STAGING_ONLY:'true',AWS_EC2_METADATA_DISABLED:'true',
  MARCOSA_EXPECTED_OIDC_SUB:expected.expectedOidcSubject,
  ACTIONS_ID_TOKEN_REQUEST_URL:
   'https://pipelines.actions.githubusercontent.com/4/5/idtoken?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN:'ci-only-'+'x'.repeat(50)
 };
 const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const time=Math.floor(clock()/1000);
 const jwt=b64({alg:'RS256',typ:'JWT'})+'.'+b64({
  iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',
  sub:expected.expectedOidcSubject,repository:env.GITHUB_REPOSITORY,
  ref:oidcEnv.GITHUB_REF,sha:commit,repository_id:'1430301644',
  repository_owner_id:'340648536',iat:time-10,exp:time+300
 })+'.'+'A'.repeat(86);
 const provider=createR171OidcTokenProvider({
  env:oidcEnv,clock,allowNetwork:true,
  fetcher:async()=>({status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify({count:1,value:jwt})})
 });
 const syntheticToken=await provider.acquire();
 ok(syntheticToken.localScopeOnly&&syntheticToken.idToken===jwt,
  'synthetic GitHub OIDC source contract failed');
 const session='marcosa-r170-'+env.GITHUB_RUN_ID;
 const sts=createR170OidcStsExchange({
  sts:{send:async command=>{
   ok(command instanceof stsSdk.AssumeRoleWithWebIdentityCommand&&
    command.input.DurationSeconds===900&&
    command.input.RoleArn===plan.AWS_ROLE_ARN,
    'unexpected STS class or role');
   return{Audience:'sts.amazonaws.com',Provider:'token.actions.githubusercontent.com',
    SubjectFromWebIdentityToken:expected.expectedOidcSubject,
    AssumedRoleUser:{Arn:'arn:aws:sts::'+accountId+
     ':assumed-role/'+role+'/'+session},
    Credentials:{AccessKeyId:'ASIA'+'A'.repeat(16),
     SecretAccessKey:'B'.repeat(40),
     SessionToken:'synthetic-'+'x'.repeat(70),
     Expiration:new Date(clock()+900000)}};
  }},
  commands:stsSdk,roleArn:plan.AWS_ROLE_ARN,region,
  ownerId:340648536,repoId:1430301644,subjectMode:'legacy',
  env:oidcEnv,clock,allowExternalCalls:true
 });
 const stsProof=await sts.exchange({idToken:syntheticToken.idToken,commit});
 ok(stsProof.awsStsResponseAccepted&&stsProof.productionAuthorized===false,
  'synthetic STS response contract failed');
 const fenceInput={nonce:randomBytes(16).toString('hex'),
  commit,archiveSha256:randomBytes(32).toString('hex'),
  reviewerDigest:randomBytes(32).toString('hex'),
  roleArn:plan.AWS_ROLE_ARN};
 const fence=createR171PostgresFence({
  executeSql:async statement=>sql('postgres',statement),clock
 });
 const once=await fence.consume(fenceInput);
 ok(once.consumedExactlyOnce&&once.productionAuthorized===false,
  'real PostgreSQL nonce+audit transaction was not committed');
 let replay=false;
 try{await createR171PostgresFence({
  executeSql:async stmt=>sql('postgres',stmt),clock
 }).consume(fenceInput);}catch{replay=true;}
 ok(replay,'same PostgreSQL nonce accepted in second connection');
 const counts=sql('postgres',
  "SELECT (SELECT count(*) FROM r171_ci.fenced_runs)::text||'|'||(SELECT count(*) FROM r171_ci.fenced_audit)::text");
 ok(counts==='1|1','PostgreSQL transaction lost audit or lease');
 const rls=sql('postgres',
  "SELECT (NOT has_table_privilege('anon','r171_ci.fenced_runs','SELECT'))::text||'|'||(NOT has_table_privilege('authenticated','r171_ci.fenced_runs','SELECT'))::text||'|'||(NOT has_table_privilege('marcosa_r171_writer','r171_ci.fenced_audit','DELETE'))::text||'|'||(SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid='r171_ci.fenced_runs'::regclass)");
 ok(rls==='true|true|true|true','PG17 RLS or private role privileges drift');
 const dump=exec('docker',['exec','-u','postgres',env.R171_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','--format=custom']);
 ok(dump.length>512&&dump.subarray(0,5).toString('utf8')==='PGDMP',
  'real native PG17 custom dump absent');
 try{
  const opts={accountId,region,clock,allowExternalCalls:true};
  const preflight=createR168AwsPreflight({
   ...opts,sts:aws.stsClient,kms:aws.kmsClient,s3:aws.s3Client,
   commands:aws.commands,bucket,kmsKeyArn
  });
  const kms=createR168AwsKmsAdapter({
   ...opts,client:aws.kmsClient,commands:aws.commands,keyArn:kmsKeyArn
  });
  const s3=createR168AwsS3Adapter({
   ...opts,client:aws.s3Client,commands:aws.commands,bucket,kmsKeyArn
  });
  const pipeline=createR168BackupPipeline({kms,s3,preflight,clock});
  const saved=await pipeline.backup({
   plaintext:dump,commit,bundleSha256:bundle.sha256,
   archiveId:randomBytes(16).toString('hex'),
   sourceInventory:beforeInventory
  });
  const restored=await pipeline.rehearseRecovery({
   reference:saved.reference,sourceInventory:beforeInventory,
   pinnedInventorySha256:saved.reference.inventorySha256,
   restoreIntoDisposableDatabase:async({database,plaintext,productionAuthorized})=>{
    ok(database==='marcosa_r168_restored'&&productionAuthorized===false,
     'recovery destination must be disposable');
    sql('postgres','CREATE DATABASE marcosa_r168_restored TEMPLATE template0;');
    exec('docker',['exec','-u','postgres','-i',env.R171_PG_CONTAINER,
     'pg_restore','-U','postgres','-d',database,
     '--no-owner','--exit-on-error'],{input:plaintext});
    return{success:true,database};
   },
   readRestoredInventory:async({database})=>
    readR167FixtureInventory({sqlRead:async q=>sql(database,q)})
  });
  ok(restored.verified&&restored.independentSqlWitnessVerified,
   'native PG17 restore failed independent RLS readback');
  const backupFence=sql('marcosa_r168_restored',
   "SELECT (SELECT count(*) FROM r171_ci.fenced_runs)::text||'|'||(SELECT count(*) FROM r171_ci.fenced_audit)::text");
  ok(backupFence==='1|1','PG17 nonce+audit did not survive native restore');
  const ref=saved.reference,sha256=ref.encryptedSha256,
   versionId=ref.versionId,
   key='marcosa/isolated/r168/'+sha256+'.r165enc';
  const head=await aws.s3Client.send(
   new aws.commands.HeadObjectCommand({
    Bucket:bucket,Key:key,VersionId:versionId
   }));
  const retention=createR170S3RetentionWitness({
   client:{send:async cmd=>{
    if(cmd instanceof s3Sdk.GetObjectRetentionCommand)
     return{Retention:{Mode:head.ObjectLockMode,
      RetainUntilDate:head.ObjectLockRetainUntilDate}};
    if(cmd instanceof s3Sdk.GetObjectAttributesCommand)
     return{VersionId:versionId,ObjectSize:head.ContentLength,
      Checksum:{ChecksumSHA256:head.ChecksumSHA256}};
    throw Error('unsupported simulated S3 read');
   }},
   commands:s3Sdk,s3,accountId,bucket,kmsKeyArn,allowExternalCalls:true,clock
  });
  const timeline=createR171S3VersionAudit({
   client:{send:async cmd=>{
    if(cmd instanceof s3Sdk.GetBucketPolicyStatusCommand)
     return{PolicyStatus:{IsPublic:false}};
    if(cmd instanceof s3Sdk.ListObjectVersionsCommand)
     return{IsTruncated:false,Versions:[
      {Key:key,VersionId:versionId,IsLatest:true,
       Size:head.ContentLength}],DeleteMarkers:[]};
    if(cmd instanceof s3Sdk.GetObjectLegalHoldCommand)
     return{LegalHold:{Status:'OFF'}};
    throw Error('unsupported version audit command');
   }},
   commands:s3Sdk,retention,accountId,bucket,kmsKeyArn,
   allowExternalCalls:true,clock
  });
  const version=await timeline.inspect({
   sha256,versionId,commit,bundleSha256:bundle.sha256,
   archiveId:ref.archiveId,contextSha256:ref.contextSha256
  });
  ok(version.verified&&version.deleteMarkerCount===0&&
   version.versionSpecificComplianceAndSha256Verified,
   'S3 immutable archive version lab evidence failed');
  const report={
   schemaVersion:1,commit,bundleSha256:bundle.sha256,
   encryptedSha256:sha256,archiveVersion:versionId,
   realPostgreSQL17BackupRestore:true,
   realPostgresNonceUniqueAcrossProcesses:true,
   realPostgresRlsAndAuditRestored:true,
   officialAwsSdkCommandClassesUsed:true,
   mockGitHubOidcAndStsContract:true,
   mockIamRoleAndBoundaryExact:true,
   mockS3ObjectVersionAndRetentionExact:true,
   actualAwsAccountConnected:false,
   actualAwsIamEffectivePermissionsAudited:false,
   actualGitHubOidcTokenIssued:false,
   actualHumanReviewVerified:false,
   customerSupabaseModified:false,productionAuthorized:false
  };
  await writeFile(join(env.RUNNER_TEMP,reportName),
   JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R171_REAL_POSTGRES17_NONCE_AUDIT_RLS_RESTORE=PASS');
  console.log('R171_GENUINE_AWS_SDK_V3_OIDC_IAM_S3_CONTRACTS=PASS');
  console.log('R171_READONLY_S3_VERSION_AND_COMPLIANCE=PASS');
  console.log('R171_REAL_AWS_TENANT_AND_PRODUCTION=NO_GO');
 }finally{dump.fill(0);}
 aws.dispose();
}
