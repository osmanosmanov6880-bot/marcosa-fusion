/**
 * MARCOSA R179 synthetic read-only Github approvals & S3 provenance backed
 * by real disposable PostgreSQL 17 atomic evidence + native restore.
 * No provider credentials, GitHub OIDC, real humans or production state.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR179GithubApprovalAudit} from './github-approval-audit.mjs';
import {createR179ReplicationProvenance} from './replication-provenance.mjs';
import {createR179ReviewGate} from './review-gate.mjs';
import {createR179StagingLedger} from './staging-ledger.mjs';
import {createR178ReplicaAudit} from '../r178/replica-audit.mjs';
const env=process.env,fail=m=>{throw Error('R179 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const reportName='r179-isolated-review-history-report.json';
const accountSource='111122223333',accountOffsite='444455556666';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'CI must not have live AWS/GitHub OIDC or customer PG credentials');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R179_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R179_PG_CONTAINER,
  'second runner may not receive PostgreSQL credentials');
 const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r179-second',reportName),'utf8'));
 const props=['schemaVersion','commit','sourceBundleSha256',
  'historyRootSha256','sourceAccountId','offsiteAccountId',
  'reviewEvidenceSha256','reviewProof',
  'realPg17ImmutableReviewAndAudit',
  'realPg17NativeBackupRestoreAndRls',
  'realPg17SeparateProcessReplayDenied',
  'syntheticGitHubReviewHistoryAndNoSelfReview',
  'syntheticS3ReplicationAndFullEncryptedBytes',
  'actualGitHubReviewersVerified','actualAwsReplicaVerified',
  'productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===props&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256&&
  H64.test(report.historyRootSha256||'')&&
  report.sourceAccountId===accountSource&&
  report.offsiteAccountId===accountOffsite,
  'source manifest, bounded evidence or two-account scope mismatch');
 const p=report.reviewProof;
 const {evidenceSha256,...manifest}=p||{};
 ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
  p.schemaVersion===1&&p.scope==='isolated-staging-review-simulation'&&
  p.decision==='CI_SIMULATED_REVIEW_ONLY'&&
  p.commit===commit&&p.bundleSha256===bundle.sha256&&
  p.historyRootSha256===report.historyRootSha256&&
  p.sourceAccountId===accountSource&&
  p.offsiteAccountId===accountOffsite&&
  p.evidenceSha256===report.reviewEvidenceSha256&&
  H64.test(p.evidenceSha256||'')&&p.evidenceSha256===sha(JSON.stringify(manifest))&&
  H64.test(p.githubEvidenceSha256||'')&&
  H64.test(p.replicationEvidenceSha256||'')&&
  H64.test(p.r178EvidenceSha256||'')&&
  p.githubReviewEventsShapeValid===true&&
  p.replicationStatusShapeValid===true&&
  p.actualHumanApprovalsVerified===false&&
  p.actualGitHubProviderIndependentlyVerified===false&&
  p.realAwsDeliveryVerified===false&&p.productionAuthorized===false,
  'independent runner rejected mutated or falsely promoted review evidence');
 for(const key of ['realPg17ImmutableReviewAndAudit',
  'realPg17NativeBackupRestoreAndRls',
  'realPg17SeparateProcessReplayDenied',
  'syntheticGitHubReviewHistoryAndNoSelfReview',
  'syntheticS3ReplicationAndFullEncryptedBytes'])
  ok(report[key]===true,'missing synthetic/native CI proof: '+key);
 for(const key of ['actualGitHubReviewersVerified',
  'actualAwsReplicaVerified','productionAuthorized'])
  ok(report[key]===false,'synthetic tests never authorize live provider');
 console.log('R179_SECOND_RUNNER_REPRODUCIBLE_SOURCE_AND_REPORT=PASS');
 console.log('R179_REAL_AWS_GITHUB_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R179_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'disposable PG17 and exact CI runner identity required');
 const exec=(name,args,{input}={})=>{
  const r=spawnSync(name,args,{input,encoding:null,timeout:60000,
   maxBuffer:40*1024*1024});
  ok(r.status===0&&!r.error,'native disposable command failed: '+name);
  return r.stdout;
 };
 const sql=(db,statement)=>exec('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',statement]).toString('utf8').trim();
 const prev=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r178-isolated-staging-evidence.json'),'utf8'));
 ok(prev.commit===commit&&prev.bundleSha256===bundle.sha256&&
  prev.realPg17ImmutableLedgerAndRls===true&&
  prev.realPg17NativeRestoreAudit===true&&
  prev.realPg17CrossProcessReplayDenied===true&&
  prev.syntheticS3CiphertextReadback===true&&
  prev.actualRealAwsAccountsUsed===false&&
  prev.actualHumanApprovalsVerified===false&&
  prev.productionAuthorized===false,
  'upstream R178 real PostgreSQL and synthetic S3 evidence required');
 const r178Proof=prev.readinessProof;
 ok(r178Proof?.evidenceSha256===prev.readinessEvidenceSha256&&
  r178Proof.historyRootSha256===prev.historyRootSha256&&
  r178Proof.probeSha256===prev.probeSha256,
  'R178 source-bound immutable readiness proof missing');
 const encryptedProbe=await readFile(join(env.RUNNER_TEMP,
  'r178-fixture-ciphertext.bin'));
 ok(encryptedProbe.length>=512&&encryptedProbe.length<=16777216&&
  sha(encryptedProbe)===prev.probeSha256,
  'same exact ephemeral AES-GCM ciphertext from R178 required');
 const readWitness=async()=>{
  const result=sql('postgres',
   "SELECT e.sequence::text||'|'||e.nonce||'|'||e.commit_sha||'|'||"+
   "e.root_sha256||'|'||e.archive_sha256||'|'||e.restored_state_sha256||'|'||"+
   "e.probe_sha256||'|'||e.source_account_id||'|'||e.offsite_account_id||'|'||"+
   "e.evidence_sha256||'|'||e.production_authorized::text "+
   "FROM r178_ci.staging_evidence e JOIN r178_ci.staging_audit a "+
   "ON a.id=e.id AND a.evidence_sha256=e.evidence_sha256 WHERE e.id=1").split('|');
  ok(result.length===11,'exact audited source PostgreSQL17 R178 record missing');
  return{sequence:Number(result[0]),nonce:result[1],commit:result[2],
   rootSha256:result[3],archiveSha256:result[4],
   restoredStateSha256:result[5],probeSha256:result[6],
   sourceAccountId:result[7],offsiteAccountId:result[8],
   evidenceSha256:result[9],productionAuthorized:result[10]==='true'};
 };
 const current=await readWitness();
 ok(current.sequence===r178Proof.sequence&&current.commit===commit&&
  current.evidenceSha256===r178Proof.evidenceSha256&&
  current.probeSha256===prev.probeSha256&&
  current.rootSha256===prev.historyRootSha256,
  'native PG17 high-water or restored database witness was changed');
 const sdk=createRequire(new URL('../r170/package.json',import.meta.url));
 const S3=sdk('@aws-sdk/client-s3');
 const fixedNow=Date.now(),clock=()=>fixedNow;
 const checksum=Buffer.from(prev.probeSha256,'hex').toString('base64');
 const expectedVersionSource=r178Proof.sourceVersionId;
 const expectedVersionOffsite=r178Proof.offsiteVersionId;
 const src={accountId:accountSource,region:'eu-west-1',
  bucket:'marcosa-source-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
 const off={accountId:accountOffsite,region:'eu-central-1',
  bucket:'marcosa-offsite-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
 let requestCount=0;
 const asFakeS3=(spec,versionId,isOffsite)=>({...spec,
  client:{send:async command=>{
   requestCount++;
   const i=command.input;
   ok(i.ExpectedBucketOwner===spec.accountId&&i.Bucket===spec.bucket,
    'injected synthetic S3 must validate exact owner');
   if(command instanceof S3.GetBucketReplicationCommand){
    ok(isOffsite===false,'no unauthorized offsite bucket replication inspection');
    return{ReplicationConfiguration:{
     Role:'arn:aws:iam::'+spec.accountId+
      ':role/marcosa-staging-cross-account-replication',
     Rules:[{Status:'Enabled',
      Filter:{Prefix:'marcosa/isolated/r178/archive/'},
      DeleteMarkerReplication:{Status:'Disabled'},
      Destination:{Bucket:'arn:aws:s3:::'+off.bucket,Account:off.accountId}}]}};
   }
   if(command instanceof S3.GetBucketVersioningCommand)return{Status:'Enabled'};
   if(command instanceof S3.GetObjectLockConfigurationCommand)return{
    ObjectLockConfiguration:{ObjectLockEnabled:'Enabled'}};
   if(command instanceof S3.GetPublicAccessBlockCommand)return{
    PublicAccessBlockConfiguration:{BlockPublicAcls:true,
     IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true}};
   if(command instanceof S3.HeadObjectCommand)return{
    VersionId:versionId,ReplicationStatus:isOffsite?'REPLICA':'COMPLETED',
    ContentLength:encryptedProbe.length,
    ContentType:'application/vnd.marcosa.r178-encrypted-archive',
    ServerSideEncryption:'aws:kms',SSEKMSKeyId:spec.kmsKeyArn,
    ObjectLockMode:'COMPLIANCE',
    ObjectLockRetainUntilDate:new Date(fixedNow+8*86400000),
    ChecksumSHA256:checksum,Metadata:{
     'marcosa-commit':commit,
     'marcosa-bundle-sha256':bundle.sha256,
     'marcosa-history-root-sha256':prev.historyRootSha256}};
   if(command instanceof S3.GetObjectRetentionCommand)return{
    Retention:{Mode:'COMPLIANCE',
     RetainUntilDate:new Date(fixedNow+8*86400000)}};
   if(command instanceof S3.GetObjectCommand)return{
    VersionId:versionId,ContentLength:encryptedProbe.length,
    ChecksumSHA256:checksum,Body:Buffer.from(encryptedProbe)};
   fail('mutating/unexpected synthetic S3 SDK call in read-only R179');
  }}});
 const sourceS3=asFakeS3(src,expectedVersionSource,false),
  offsiteS3=asFakeS3(off,expectedVersionOffsite,true);
 const full=createR178ReplicaAudit({source:sourceS3,offsite:offsiteS3,
  commands:S3,clock,allowExternalCalls:true});
 const replication=createR179ReplicationProvenance({
  source:sourceS3,offsite:offsiteS3,
  commands:S3,clock,allowExternalCalls:true});
 const runId=Number(env.GITHUB_RUN_ID),actorId=1001;
 const reviewers=[2002,3003];
 const reviewTime=new Date(fixedNow-500).toISOString();
 const runStarted=new Date(fixedNow-1000).toISOString();
 const fetcher=async url=>{
  ok(typeof url==='string'&&url.startsWith(
   'https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion/'),
   'synthetic GitHub read-only endpoint not pinned');
  const data=url.endsWith('/approvals')?
   reviewers.map(id=>({state:'approved',user:{id,type:'User'},
    environments:[{id:91,name:'marcosa-aws-staging',updated_at:reviewTime}]})):
   {id:runId,head_sha:commit,
    head_branch:'feature/marcosa-r150-growth-economics',
    event:'workflow_dispatch',run_attempt:1,actor:{id:actorId,type:'User'},
    repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
    head_repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
    path:'.github/workflows/marcosa-r179-readiness.yml@refs/heads/feature/marcosa-r150-growth-economics',
    status:'in_progress',run_started_at:runStarted};
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(data)};
 };
 const githubAudit=createR179GithubApprovalAudit({
  fetcher,token:'ci-synthetic-review-token',
  runId,commit,actorId,reviewerIds:reviewers,
  clock,allowExternalCalls:true});
 const gate=createR179ReviewGate({readR178Witness:readWitness,
  githubAudit,replicationAudit:replication,replicaReadback:full,
  clock,allowEvaluate:true});
 const proof=await gate.inspect({r178Proof,runId,actorId,
  commit,bundleSha256:bundle.sha256,
  historyRootSha256:prev.historyRootSha256,
  probeSha256:prev.probeSha256,
  sourceVersionId:expectedVersionSource,
  offsiteVersionId:expectedVersionOffsite});
 ok(proof.decision==='CI_SIMULATED_REVIEW_ONLY'&&
  proof.actualHumanApprovalsVerified===false&&
  proof.realAwsDeliveryVerified===false&&
  proof.productionAuthorized===false&&requestCount===15,
  'R179 exact duplicate full-GET S3 and review status checks incomplete');
 const store=createR179StagingLedger({executeSql:async q=>sql('postgres',q)});
 ok((await store.record(proof)).recorded,
  'native append-only PG17 review evidence insert missing');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r179_ci.review_evidence)::text||'|'||"+
  "(SELECT count(*) FROM r179_ci.review_audit)::text");
 const checkRoles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r179_ci.review_evidence'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r179_ci.review_evidence','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r179_writer','r179_ci.review_audit','UPDATE'))::text");
 ok(counts('postgres')==='1|1'&&
  checkRoles('postgres')==='true|true|true',
  'native PostgreSQL17 R179 audit missing or RLS weakened');
 let replay=false;
 try{await createR179StagingLedger({
  executeSql:async q=>sql('postgres',q)
 }).record(proof);}catch{replay=true;}
 ok(replay,'R179 PostgreSQL allowed replay in a new connection');
 const dump=exec('docker',['exec','-u','postgres',env.R179_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'true native PG17 custom backup not created');
 try{
  sql('postgres','CREATE DATABASE marcosa_r179_restored TEMPLATE template0');
  exec('docker',['exec','-u','postgres','-i',env.R179_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r179_restored',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 ok(counts('marcosa_r179_restored')==='1|1'&&
  checkRoles('marcosa_r179_restored')==='true|true|true',
  'native restored PG17 lost approvals/audit or RLS');
 replay=false;
 try{await createR179StagingLedger({
  executeSql:async q=>sql('marcosa_r179_restored',q)
 }).record(proof);}catch{replay=true;}
 ok(replay,'restored PostgreSQL17 allowed duplicate deployment review');
 const report={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  historyRootSha256:prev.historyRootSha256,
  sourceAccountId:accountSource,offsiteAccountId:accountOffsite,
  reviewEvidenceSha256:proof.evidenceSha256,reviewProof:proof,
  realPg17ImmutableReviewAndAudit:true,
  realPg17NativeBackupRestoreAndRls:true,
  realPg17SeparateProcessReplayDenied:true,
  syntheticGitHubReviewHistoryAndNoSelfReview:true,
  syntheticS3ReplicationAndFullEncryptedBytes:true,
  actualGitHubReviewersVerified:false,
  actualAwsReplicaVerified:false,productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,reportName),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 encryptedProbe.fill(0);
 console.log('R179_NATIVE_PG17_APPROVAL_REPLICA_RECORD_AND_RESTORE=PASS');
 console.log('R179_SYNTHETIC_GITHUB_DEPLOYMENT_REVIEW_EVENTS=PASS');
 console.log('R179_SYNTHETIC_TWO_ACCOUNT_S3_FULL_CIPHER_AND_STATUS=PASS');
 console.log('R179_REAL_PROVIDER_HUMANS_AND_PRODUCTION=NO_GO');
}
