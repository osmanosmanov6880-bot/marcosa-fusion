/**
 * R172 disposable real PostgreSQL17 and official AWS SDK v3 integration.
 * All GitHub/OIDC/AWS server responses are synthetic (injected no-network).
 * Mode A: native PG17 dump/restore and audited static recovery budget.
 * Mode B: separate runner verifies exact source and strictly nonsecret report.
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
import {createR171PostgresFence} from '../r171/pg-fence.mjs';
import {createR172GitHubEnvironmentAudit} from './github-environment.mjs';
import {createR172AwsIdentityAudit} from './aws-identity.mjs';
import {createR172ReplicationAudit} from './replication-audit.mjs';
import {createR172RecoveryBudget} from './recovery-budget.mjs';

const env=process.env,fail=m=>{throw Error('R172 CI: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const H64=/^[a-f0-9]{64}$/,H40=/^[a-f0-9]{40}$/;
const reportName='r172-isolated-readiness-evidence.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'only isolated GitHub no-AWS-credentials workflow permitted');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R172_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,
  'second runner must not have PG or AWS credentials');
 const report=JSON.parse(await readFile(
  join(env.RUNNER_TEMP,'r172-second',reportName),'utf8'));
 const expected=[
  'schemaVersion','commit','bundleSha256','archiveSha256',
  'rtoMsMeasuredInSyntheticPg17','syntheticRowsLost',
  'realPg17NativeRestoreVerified','realPg17NonceReplayRejected',
  'realPg17RlsAndAuditPreserved',
  'genuinePublishedAwsSdkV3Commands',
  'syntheticGitHubEnvironmentReviewed',
  'syntheticAwsStsAndIamOidcProviderReviewed',
  'syntheticS3CrossAccountReplicationAndKmsReviewed',
  'actualGitHubProtectedEnvironmentProven',
  'actualAwsProviderConnected',
  'actualOffsiteReplicaRestored','productionRpoRtoProven',
  'actualHumanApprovalVerified','actualSupabaseChanged',
  'productionAuthorized'
 ].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===expected&&
  report.schemaVersion===1&&report.commit===commit&&
  report.bundleSha256===bundle.sha256&&
  H64.test(report.archiveSha256||'')&&
  Number.isSafeInteger(report.rtoMsMeasuredInSyntheticPg17)&&
  report.rtoMsMeasuredInSyntheticPg17>=0&&
  report.rtoMsMeasuredInSyntheticPg17<=120000&&
  report.syntheticRowsLost===0,
  'independent signed-source report not exact or bounded');
 for(const key of [
  'realPg17NativeRestoreVerified','realPg17NonceReplayRejected',
  'realPg17RlsAndAuditPreserved','genuinePublishedAwsSdkV3Commands',
  'syntheticGitHubEnvironmentReviewed',
  'syntheticAwsStsAndIamOidcProviderReviewed',
  'syntheticS3CrossAccountReplicationAndKmsReviewed'
 ])ok(report[key]===true,'missing isolated lab proof '+key);
 for(const key of [
  'actualGitHubProtectedEnvironmentProven','actualAwsProviderConnected',
  'actualOffsiteReplicaRestored','productionRpoRtoProven',
  'actualHumanApprovalVerified','actualSupabaseChanged',
  'productionAuthorized'
 ])ok(report[key]===false,'false real-world cloud or production claim '+key);
 console.log('R172_SECOND_RUNNER_SOURCE_AND_EVIDENCE=PASS');
 console.log('R172_REAL_AWS_ACCOUNT_OFFSITE_RPO_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R172_PG_CONTAINER||'')&&
  /^[0-9]{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'disposable native PG17 container and GitHub run required');
 const exec=(binary,args,{input}={})=>{
  const p=spawnSync(binary,args,{input,encoding:null,
   timeout:60000,maxBuffer:40*1024*1024});
  ok(p.status===0&&!p.error,'real PostgreSQL command failed: '+binary);
  return p.stdout;
 };
 const sql=(db,q)=>exec('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',q]).toString('utf8').trim();
 const sdk=createRequire(new URL('../r170/package.json',import.meta.url));
 const IAM=sdk('@aws-sdk/client-iam'),KMS=sdk('@aws-sdk/client-kms'),
  S3=sdk('@aws-sdk/client-s3'),STS=sdk('@aws-sdk/client-sts');
 ok(typeof IAM.GetOpenIDConnectProviderCommand==='function'&&
  typeof STS.GetCallerIdentityCommand==='function'&&
  typeof S3.GetBucketReplicationCommand==='function'&&
  typeof KMS.GetKeyRotationStatusCommand==='function'&&
  typeof KMS.DescribeKeyCommand==='function',
  'actual AWS SDK v3 IAM/STS/S3/KMS command classes required');
 const now=Date.now(),clock=()=>now;
 const branch='feature/marcosa-r150-growth-economics';
 const runContext={
  GITHUB_ACTIONS:'true',
  GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
  GITHUB_REF:'refs/heads/'+branch,
  GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_RUN_ATTEMPT:'1',
  GITHUB_RUN_ID:env.GITHUB_RUN_ID,GITHUB_SHA:commit,
  GITHUB_REPOSITORY_ID:'1430301644',
  GITHUB_REPOSITORY_OWNER_ID:'340648536',
  MARCOSA_GITHUB_ENV_AUDIT_TOKEN:'ci-only-'+ 'x'.repeat(32)
 };
 const environment={
  id:245631,name:'marcosa-aws-staging',
  deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
  protection_rules:[{type:'branch_policy'},
   {type:'required_reviewers',prevent_self_review:true,
    reviewers:[{type:'User',reviewer:{id:1001}},
     {type:'User',reviewer:{id:1002}}]}]
 };
 const policy={total_count:1,branch_policies:[{name:branch}]};
 const runDetails={event:'workflow_dispatch',head_branch:branch,
  head_sha:commit,run_attempt:1,
  repository:{id:1430301644,full_name:runContext.GITHUB_REPOSITORY,
   owner:{id:340648536}},
  head_repository:{id:1430301644},actor:{id:99},
  path:'.github/workflows/marcosa-r171-live-staging.yml@refs/heads/'+branch,
  status:'in_progress'};
 const gh=createR172GitHubEnvironmentAudit({
  env:runContext,clock,allowExternalCalls:true,
  fetcher:async url=>({status:200,
   headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(url.includes('/deployment-branch-policies?')?
    policy:url.includes('/actions/runs/')?runDetails:environment)
  })
 });
 const ghProof=await gh.inspect();
 ok(ghProof.verified&&ghProof.twoActualHumanApprovalsVerified===false,
  'mock protected-environment policy refused');
 const aws=createR168SimulatedAws({clock});
 try{
  const accountId=aws.accountId,region=aws.region,
   bucket=aws.bucket,kmsKeyArn=aws.keyArn;
  const session='marcosa-r170-'+env.GITHUB_RUN_ID;
  const roleId='AROA'+'A'.repeat(16);
  const sessionArn='arn:aws:sts::'+accountId+
   ':assumed-role/marcosa-staging-backup-role/'+session;
  const identity=createR172AwsIdentityAudit({
   stsClient:{send:async cmd=>{
    ok(cmd instanceof STS.GetCallerIdentityCommand,'genuine STS command required');
    return{Account:accountId,Arn:sessionArn,UserId:roleId+':'+session};
   }},
   iamAuditorClient:{send:async cmd=>{
    ok(cmd instanceof IAM.GetOpenIDConnectProviderCommand,
     'genuine IAM OIDC provider command required');
    return{Url:'token.actions.githubusercontent.com',
     ClientIDList:['sts.amazonaws.com'],ThumbprintList:['a'.repeat(40)]};
   }},
   commands:{GetCallerIdentityCommand:STS.GetCallerIdentityCommand,
    GetOpenIDConnectProviderCommand:IAM.GetOpenIDConnectProviderCommand},
   accountId,sourceRoleId:roleId,runId:env.GITHUB_RUN_ID,
   expectedSessionArn:sessionArn,clock,allowExternalCalls:true
  });
  const identityProof=await identity.inspect();
  ok(identityProof.verified&&identityProof.awsIamEffectiveRightsProven===false,
   'synthetic STS/IAM provider not inspected');
  const offsiteAccountId='444455556666',offsiteRegion='eu-central-1',
   offsiteBucket='marcosa-offsite-ci-locked';
  const offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
  const replication=createR172ReplicationAudit({
   sourceAccountId:accountId,sourceRegion:region,
   sourceBucket:bucket,sourceKmsArn:kmsKeyArn,
   offsiteAccountId,offsiteRegion,offsiteBucket,offsiteKmsArn,
   sourceS3:{send:async cmd=>{
    ok(cmd instanceof S3.GetBucketReplicationCommand,
     'genuine S3 replication-read command required');
    return{ReplicationConfiguration:{
     Role:'arn:aws:iam::'+accountId+
      ':role/marcosa-staging-cross-account-replication',
     Rules:[{
      ID:'marcosa-r172-offsite-immutable',Priority:1,Status:'Enabled',
      Filter:{Prefix:'marcosa/isolated/r168/'},
      DeleteMarkerReplication:{Status:'Disabled'},
      SourceSelectionCriteria:{SseKmsEncryptedObjects:{Status:'Enabled'}},
      Destination:{Bucket:'arn:aws:s3:::'+offsiteBucket,
       Account:offsiteAccountId,
       EncryptionConfiguration:{ReplicaKmsKeyID:offsiteKmsArn}}
     }]
    }};
   }},
   sourceKms:{send:async cmd=>{
    if(cmd instanceof KMS.GetKeyRotationStatusCommand)
     return{KeyRotationEnabled:true};
    ok(cmd instanceof KMS.DescribeKeyCommand,'unexpected KMS command');
    return{KeyMetadata:{Arn:kmsKeyArn,AWSAccountId:accountId,
     Enabled:true,KeyState:'Enabled',
     KeySpec:'SYMMETRIC_DEFAULT',KeyUsage:'ENCRYPT_DECRYPT'}};
   }},
   offsiteKms:{send:async cmd=>{
    if(cmd instanceof KMS.GetKeyRotationStatusCommand)
     return{KeyRotationEnabled:true};
    ok(cmd instanceof KMS.DescribeKeyCommand,'unexpected second-account KMS');
    return{KeyMetadata:{Arn:offsiteKmsArn,AWSAccountId:offsiteAccountId,
     Enabled:true,KeyState:'Enabled',
     KeySpec:'SYMMETRIC_DEFAULT',KeyUsage:'ENCRYPT_DECRYPT'}};
   }},
   commands:{
    GetBucketReplicationCommand:S3.GetBucketReplicationCommand,
    GetKeyRotationStatusCommand:KMS.GetKeyRotationStatusCommand,
    DescribeKeyCommand:KMS.DescribeKeyCommand},
   clock,allowExternalCalls:true
  });
  const replicaProof=await replication.inspect();
  ok(replicaProof.inspected&&replicaProof.replicaDeliveryConfirmed===false,
   'cross-account replication configuration not reviewed');
  const roles={accountId,region,bucketName:bucket,kmsKeyArn,
   ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
  const plan=createR169IamPlan({...roles,
   expectedOidcSubject:r169GitHubOidcSubject(roles)});
  ok(plan.productionAuthorized===false,
   'unapproved real AWS authority requested');
  const fenceInput={nonce:randomBytes(16).toString('hex'),
   commit,archiveSha256:randomBytes(32).toString('hex'),
   reviewerDigest:randomBytes(32).toString('hex'),roleArn:plan.AWS_ROLE_ARN};
  const fence=createR171PostgresFence({
   executeSql:async q=>sql('postgres',q),clock
  });
  const grant=await fence.consume(fenceInput);
  ok(grant.consumedExactlyOnce,'one-use PostgreSQL nonce not recorded');
  const readCounts=async({database})=>{
   const line=sql(database,
    "SELECT (SELECT count(*) FROM r171_ci.fenced_runs)::text||'|'||(SELECT count(*) FROM r171_ci.fenced_audit)::text");
   const [runs,audit]=line.split('|');
   return{runs:Number(runs),audit:Number(audit)};
  };
  const getInventory=async({database})=>
   readR167FixtureInventory({sqlRead:async q=>sql(database,q)});
  const quarantine={status:async()=>{
   const v=sql('postgres',
    "SELECT closed::text||'|'||generation::text FROM r167_ci.r167_quarantine WHERE id=1");
   const [closed,generation]=v.split('|');
   return{closed:closed==='true',generation:Number(generation)};
  }};
  const opts={accountId,region,clock,allowExternalCalls:true};
  const preflight=createR168AwsPreflight({
   ...opts,sts:aws.stsClient,kms:aws.kmsClient,
   s3:aws.s3Client,commands:aws.commands,
   bucket,kmsKeyArn
  });
  const kms=createR168AwsKmsAdapter({
   ...opts,client:aws.kmsClient,commands:aws.commands,
   keyArn:kmsKeyArn
  });
  const s3=createR168AwsS3Adapter({
   ...opts,client:aws.s3Client,commands:aws.commands,
   bucket,kmsKeyArn
  });
  const pipeline=createR168BackupPipeline({kms,s3,preflight,clock});
  const measure=createR172RecoveryBudget({
   getInventory,readNonceCounts:readCounts,quarantine,
   backupAndSeal:async({sourceInventory})=>{
    const dump=exec('docker',['exec','-u','postgres',
     env.R172_PG_CONTAINER,'pg_dump','-U','postgres','-d','postgres',
     '--format=custom']);
    ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&
     dump.length>=512,'native PostgreSQL17 archive expected');
    try{
     return await pipeline.backup({
      plaintext:dump,commit,bundleSha256:bundle.sha256,
      archiveId:randomBytes(16).toString('hex'),sourceInventory
     });
    }finally{dump.fill(0);}
   },
   restoreIntoDisposablePg:async({
    reference,sourceInventory,pinnedInventorySha256,targetDatabase
   })=>{
    ok(targetDatabase==='marcosa_r168_restored',
     'only hard-pinned disposable restore target');
    const out=await pipeline.rehearseRecovery({
     reference,sourceInventory,pinnedInventorySha256,
     restoreIntoDisposableDatabase:async({database,plaintext,productionAuthorized})=>{
      ok(database===targetDatabase&&productionAuthorized===false,
       'restore callback target or trust flag invalid');
      sql('postgres','CREATE DATABASE marcosa_r168_restored TEMPLATE template0');
      exec('docker',['exec','-u','postgres','-i',
       env.R172_PG_CONTAINER,'pg_restore','-U','postgres',
       '--no-owner','--exit-on-error','-d',database],{input:plaintext});
      return{success:true,database};
     },
     readRestoredInventory:async({database})=>getInventory({database})
    });
    return{verified:out.verified,database:out.restoredDatabase,
     productionAuthorized:false};
   },
   verifyReplayDenied:async({database})=>{
    let denied=false;
    try{
     await createR171PostgresFence({
      executeSql:async q=>sql(database,q),clock
     }).consume(fenceInput);
    }catch{denied=true;}
    const c=await readCounts({database});
    return{denied,rowCount:c.runs,auditCount:c.audit};
   },
   maxRestoreMs:120000,wallClock:clock
  });
  const receipt=await measure.exercise({
   commit,bundleSha256:bundle.sha256,nonce:fenceInput.nonce
  });
  ok(receipt.complete&&receipt.syntheticRowsLost===0&&
   receipt.restoredRlsAndSessionParity&&
   receipt.duplicateNonceDeniedAfterRestore&&
   receipt.actualProductionRpoProven===false,
   'real disposable PG17 recovery budget not accepted');
  const report={
   schemaVersion:1,commit,bundleSha256:bundle.sha256,
   archiveSha256:receipt.archiveSha256,
   rtoMsMeasuredInSyntheticPg17:receipt.observedSyntheticRtoMs,
   syntheticRowsLost:receipt.syntheticRowsLost,
   realPg17NativeRestoreVerified:true,
   realPg17NonceReplayRejected:true,
   realPg17RlsAndAuditPreserved:true,
   genuinePublishedAwsSdkV3Commands:true,
   syntheticGitHubEnvironmentReviewed:true,
   syntheticAwsStsAndIamOidcProviderReviewed:true,
   syntheticS3CrossAccountReplicationAndKmsReviewed:true,
   actualGitHubProtectedEnvironmentProven:false,
   actualAwsProviderConnected:false,
   actualOffsiteReplicaRestored:false,productionRpoRtoProven:false,
   actualHumanApprovalVerified:false,actualSupabaseChanged:false,
   productionAuthorized:false
  };
  await writeFile(join(env.RUNNER_TEMP,reportName),
   JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R172_REAL_PG17_ENCRYPTED_DUMP_RESTORE_RLS_AND_AUDIT=PASS');
  console.log('R172_REAL_PG17_MEASURED_STATIC_RTO_AND_NONCE_REPLAY=PASS');
  console.log('R172_OFFICIAL_SDK_GITHUB_IAM_S3_KMS_MOCK_CONTRACTS=PASS');
  console.log('R172_ACTUAL_GITHUB_ENV_AWS_OFFSITE_AND_PRODUCTION=NO_GO');
 }finally{aws.dispose();}
}
