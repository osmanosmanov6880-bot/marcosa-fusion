/**
 * R181 two-runner CI: REAL disposable PostgreSQL17 + two mock provider
 * responses that NEVER attest actual AWS or real human GitHub reviewers.
 * Uses exact R178 AES-GCM fixture bytes, preserved through R179/R180.
 * No live AWS, GitHub approval changes, OIDC or deployment possible.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR181GithubPolicyInspector} from './github-policy-inspector.mjs';
import {createR181AwsReadOnlyProbe} from './aws-readonly-cli.mjs';
import {createR181StagingEvaluator} from './staging-evaluator.mjs';
import {createR181ObservationLedger} from './observation-ledger.mjs';
const env=process.env,fail=m=>{throw Error('R181 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const name='r181-readonly-observation-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'no AWS, OIDC or real client credentials in CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R181_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R181_PG_CONTAINER,
  'independent runner cannot receive database credentials');
 const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r181-second',name),'utf8'));
 const keys=['schemaVersion','commit','sourceBundleSha256',
  'r180ClassificationSha256','r180QuorumReceiptSha256',
  'observation','observationEvidenceSha256',
  'realPg17OneTimeReadOnlyObservation','realPg17RlsAndQuarantineRestored',
  'realPg17CrossSessionReplayRejected','syntheticGithubEnvironmentAndApprovals',
  'syntheticAwsProfilesAndFullEncryptedGet',
  'realAwsProvidersIndependentlyAttested','realHumanReviewersVerified',
  'productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===keys&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256&&
  H64.test(report.r180ClassificationSha256||'')&&
  H64.test(report.r180QuorumReceiptSha256||'')&&
  H64.test(report.observationEvidenceSha256||''),
  'source-controlled independent R181 report schema/digest missing');
 const e=report.observation;
 const {evidenceSha256,...body}=e||{};
 ok(e&&Object.getPrototypeOf(e)===Object.prototype&&
  e.schemaVersion===1&&
  e.sourceCommit===commit&&e.sourceBundleSha256===bundle.sha256&&
  e.scope==='isolated-staging-readonly-observation'&&
  e.sourceMode==='CI_SYNTHETIC'&&
  e.classificationSha256===report.r180ClassificationSha256&&
  e.quorumReceiptSha256===report.r180QuorumReceiptSha256&&
  e.decision==='NO_GO_PROVIDER_ATTESTATION_PENDING'&&
  e.productionAuthorized===false&&
  e.actualIndependentProviderAttestation===false&&
  e.naturalPersonSeparationIndependentlyVerified===false&&
  e.restoreRpoRtoAndPrivacyVerified===false&&
  e.quarantineRemainsClosed===true&&
  H64.test(e.githubEvidenceSha256||'')&&
  H64.test(e.awsEvidenceSha256||'')&&
  e.evidenceSha256===report.observationEvidenceSha256&&
  sha(Buffer.from(JSON.stringify(body)))===e.evidenceSha256,
  'independent runner detected promoted or modified simulation evidence');
 for(const field of ['realPg17OneTimeReadOnlyObservation',
  'realPg17RlsAndQuarantineRestored','realPg17CrossSessionReplayRejected',
  'syntheticGithubEnvironmentAndApprovals',
  'syntheticAwsProfilesAndFullEncryptedGet'])
  ok(report[field]===true,'native or injected provider check absent: '+field);
 for(const field of ['realAwsProvidersIndependentlyAttested',
  'realHumanReviewersVerified','productionAuthorized'])
  ok(report[field]===false,
   'synthetic results cannot become provider/human/deployment approval');
 console.log('R181_INDEPENDENT_SOURCE_SHA_AND_NO_GO=PASS');
 console.log('R181_EXTERNAL_CREDENTIALS_HUMANS_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R181_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'requires true disposable PostgreSQL17 and exact CI run');
 const run=(cmd,args,{input}={})=>{
  const p=spawnSync(cmd,args,{encoding:null,input,timeout:60000,
   maxBuffer:40*1024*1024});
  ok(p.status===0&&!p.error,'native PostgreSQL command failed: '+cmd);
  return p.stdout;
 };
 const sql=(db,q)=>run('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1',
  '-d',db,'-c',q]).toString('utf8').trim();
 const prior=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r180-durable-no-go-report.json'),'utf8'));
 const earlier=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r178-isolated-staging-evidence.json'),'utf8'));
 const bytes=await readFile(join(env.RUNNER_TEMP,'r178-fixture-ciphertext.bin'));
 ok(prior.commit===commit&&prior.sourceBundleSha256===bundle.sha256&&
  prior.realPg17ImmutableNoGoJournal===true&&
  prior.realPg17QuarantineClosed===true&&
  prior.realPg17NativeRestoreAndReplayDenied===true&&
  prior.realAwsProviderVerified===false&&
  prior.realHumanApprovalsVerified===false&&
  prior.productionAuthorized===false&&
  earlier.commit===commit&&earlier.bundleSha256===bundle.sha256&&
  earlier.realPg17NativeRestoreAudit===true&&
  earlier.syntheticS3CiphertextReadback===true&&
  bytes.length>512&&sha(bytes)===earlier.probeSha256,
  'real R180 PG17 hold and exact R178 source application bytes mandatory');
 const runId=Number(env.GITHUB_RUN_ID),actorId=prior.classification.actorId;
 ok(runId===prior.classification.runId&&Number.isSafeInteger(actorId)&&actorId>0,
  'R180 hold and run actor must match exact current CI');
 const now=Date.now(),clock=()=>now;
 const reviewerIds=[2002,3003],environmentId=91;
 const reviews=reviewerIds.map(id=>({state:'approved',
  user:{id,type:'User'},environments:[{
   id:environmentId,name:'marcosa-aws-staging',
   updated_at:new Date(now-1000).toISOString()}]}));
 const ghFetcher=async url=>{
  ok(url.startsWith('https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion/'),
   'mock GitHub read-only path escaped');
  const data=url.includes('/environments/')?{
   id:environmentId,name:'marcosa-aws-staging',
   deployment_branch_policy:{protected_branches:true,
    custom_branch_policies:false},
   protection_rules:[
    {id:4,type:'branch_policy'},
    {id:5,type:'required_reviewers',prevent_self_review:true,
     reviewers:reviewerIds.map(id=>({
      type:'User',reviewer:{id,type:'User'}}))}]
  }:url.includes('/protection')?{
   required_status_checks:{strict:true},enforce_admins:{enabled:true},
   required_pull_request_reviews:{
    dismiss_stale_reviews:true,required_approving_review_count:2},
   allow_force_pushes:{enabled:false},
   allow_deletions:{enabled:false}
  }:url.endsWith('/approvals')?reviews:{
   id:runId,head_sha:commit,
   head_branch:'feature/marcosa-r150-growth-economics',
   event:'workflow_dispatch',run_attempt:1,
   actor:{id:actorId,type:'User'},
   repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
   head_repository:{full_name:'osmanosmanov6880-bot/marcosa-fusion'},
   path:'.github/workflows/marcosa-r181-readiness.yml',
   run_started_at:new Date(now-2000).toISOString()
  };
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(data)};
 };
 const githubInspector=createR181GithubPolicyInspector({
  fetcher:ghFetcher,token:'r181-fake-ci-not-a-real-token',
  runId,commit,actorId,reviewerIds,clock,allowNetwork:true});
 const source={profile:'source_ci_only',region:'eu-west-1',
  accountId:'111122223333',bucket:'marcosa-source-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
 const offsite={profile:'offsite_ci_only',region:'eu-central-1',
  accountId:'444455556666',bucket:'marcosa-offsite-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
 const sourceVersionId=earlier.readinessProof.sourceVersionId;
 const offsiteVersionId=earlier.readinessProof.offsiteVersionId;
 const checksum=Buffer.from(earlier.probeSha256,'hex').toString('base64');
 let awsRequests=0;
 const executeAws=async({profile,service,operation,params})=>{
  awsRequests++;
  const src=profile===source.profile;
  const target=src?source:offsite;
  if(service==='sts')return{json:{
   Account:target.accountId,
   Arn:'arn:aws:sts::'+target.accountId+
    ':assumed-role/marcosa-r178-readonly-auditor/r181-ci',
   UserId:'AROA'+'A'.repeat(16)+':r181-ci'}};
  ok(profile===source.profile||profile===offsite.profile,
   'no unexpected AWS CI profile');
  ok(params.ExpectedBucketOwner===target.accountId&&
   params.Bucket===target.bucket,
   'AWS simulated expected-bucket-owner required');
  const version=src?sourceVersionId:offsiteVersionId;
  switch(operation){
   case 'get-bucket-replication':return{json:{ReplicationConfiguration:{
    Role:'arn:aws:iam::'+source.accountId+
     ':role/marcosa-staging-cross-account-replication',
    Rules:[{Status:'Enabled',
     Filter:{Prefix:'marcosa/isolated/r178/archive/'},
     DeleteMarkerReplication:{Status:'Disabled'},
     Destination:{Bucket:'arn:aws:s3:::'+offsite.bucket,
      Account:offsite.accountId}}]}}};
   case 'get-bucket-versioning':return{json:{Status:'Enabled'}};
   case 'get-object-lock-configuration':return{json:{
    ObjectLockConfiguration:{ObjectLockEnabled:'Enabled'}}};
   case 'get-public-access-block':return{json:{
    PublicAccessBlockConfiguration:{BlockPublicAcls:true,
     IgnorePublicAcls:true,BlockPublicPolicy:true,
     RestrictPublicBuckets:true}}};
   case 'head-object':return{json:{
    VersionId:version,ReplicationStatus:src?'COMPLETED':'REPLICA',
    ContentLength:bytes.length,ChecksumSHA256:checksum,
    ContentType:'application/vnd.marcosa.r178-encrypted-archive',
    ServerSideEncryption:'aws:kms',SSEKMSKeyId:target.kmsKeyArn,
    ObjectLockMode:'COMPLIANCE',Metadata:{
     'marcosa-commit':commit,
     'marcosa-bundle-sha256':bundle.sha256,
     'marcosa-history-root-sha256':earlier.historyRootSha256}}};
   case 'get-object-retention':return{json:{Retention:{
    Mode:'COMPLIANCE',RetainUntilDate:
     new Date(now+8*86400000).toISOString()}}};
   case 'get-object':return{json:{VersionId:version,
    ContentLength:bytes.length},bytes:Buffer.from(bytes)};
   default:fail('synthetic AWS mutating/unexpected action refused');
  }
 };
 const awsInspector=createR181AwsReadOnlyProbe({source,offsite,
  executeAws,clock,allowNetwork:true});
 const readHold=async()=>{
  const row=sql('postgres',
   "SELECT h.run_id::text||'|'||h.sequence::text||'|'||h.nonce||'|'||"+
   "h.commit_sha||'|'||h.classification_sha256||'|'||"+
   "h.quorum_receipt_sha256||'|'||h.decision||'|'||"+
   "h.production_authorized::text FROM r180_ci.holds h "+
   "JOIN r180_ci.hold_audit a ON a.id=h.id AND "+
   "a.classification_sha256=h.classification_sha256 AND "+
   "a.quorum_receipt_sha256=h.quorum_receipt_sha256 WHERE h.id=1").split('|');
  ok(row.length===8,'real R180 immutable PostgreSQL hold/audit missing');
  return{runId:Number(row[0]),sequence:Number(row[1]),nonce:row[2],
   sourceCommit:row[3],classificationSha256:row[4],
   quorumReceiptSha256:row[5],decision:row[6],
   productionAuthorized:row[7]==='true'};
 };
 const quarantine={status:async()=>{
  const r=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(r.length===2,'disposable real PostgreSQL quarantine missing');
  return{closed:r[0]==='true',generation:Number(r[1])};
 }};
 const evaluator=createR181StagingEvaluator({readR180Hold:readHold,
  quarantine,githubInspector,awsInspector,clock,allowInspect:true});
 const observation=await evaluator.inspect({
  sourceMode:'CI_SYNTHETIC',commit,bundleSha256:bundle.sha256,
  historyRootSha256:earlier.historyRootSha256,
  sha256:earlier.probeSha256,sourceVersionId,offsiteVersionId});
 ok(observation.decision==='NO_GO_PROVIDER_ATTESTATION_PENDING'&&
  observation.productionAuthorized===false&&
  observation.sourceMode==='CI_SYNTHETIC'&&
  observation.classificationSha256===prior.classificationSha256&&
  observation.quorumReceiptSha256===prior.quorumReceiptSha256&&
  awsRequests===15,'native read-only PG17 / mocked AWS scope was not bound');
 const ledger=createR181ObservationLedger({
  executeSql:async q=>sql('postgres',q)});
 ok((await ledger.record(observation)).recorded===true,
  'new real PostgreSQL17 append-only evidence not recorded');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r181_ci.observations)::text||'|'||"+
  "(SELECT count(*) FROM r181_ci.observation_audit)::text||'|'||"+
  "(SELECT count(*) FROM r180_ci.holds)::text||'|'||"+
  "(SELECT count(*) FROM r180_ci.hold_audit)::text");
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r181_ci.observations'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r181_ci.observation_audit'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r181_ci.observations','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r181_writer','r180_ci.holds','UPDATE'))::text");
 ok(counts('postgres')==='1|1|1|1'&&
  roles('postgres')==='true|true|true|true',
  'real native PG17 R181 RLS/audit parity missing');
 let refused=false;
 try{await createR181ObservationLedger({
  executeSql:async q=>sql('postgres',q)
 }).record(observation);}catch{refused=true;}
 ok(refused,'same observation replay accepted by separate SQL session');
 const dump=run('docker',['exec','-u','postgres',env.R181_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'real PG17 native backup missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r181_restored TEMPLATE template0');
  run('docker',['exec','-u','postgres','-i',env.R181_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r181_restored',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 ok(counts('marcosa_r181_restored')==='1|1|1|1'&&
  roles('marcosa_r181_restored')==='true|true|true|true'&&
  sql('marcosa_r181_restored',
   'SELECT decision FROM r181_ci.observations WHERE id=1')===
   'NO_GO_PROVIDER_ATTESTATION_PENDING'&&
  sql('marcosa_r181_restored',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true',
  'PG17 restore lost NO-GO, native quarantine or FORCE RLS');
 refused=false;
 try{await createR181ObservationLedger({
  executeSql:async q=>sql('marcosa_r181_restored',q)
 }).record(observation);}catch{refused=true;}
 ok(refused,'restored PostgreSQL accepted replayed evidence');
 const report={schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r180ClassificationSha256:prior.classificationSha256,
  r180QuorumReceiptSha256:prior.quorumReceiptSha256,
  observation,observationEvidenceSha256:observation.evidenceSha256,
  realPg17OneTimeReadOnlyObservation:true,
  realPg17RlsAndQuarantineRestored:true,
  realPg17CrossSessionReplayRejected:true,
  syntheticGithubEnvironmentAndApprovals:true,
  syntheticAwsProfilesAndFullEncryptedGet:true,
  realAwsProvidersIndependentlyAttested:false,
  realHumanReviewersVerified:false,productionAuthorized:false};
 await writeFile(join(env.RUNNER_TEMP,name),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 bytes.fill(0);
 console.log('R181_NATIVE_PG17_READONLY_EVIDENCE_AND_RESTORE=PASS');
 console.log('R181_GITHUB_AWS_SYNTHETIC_TESTS_NO_GO=PASS');
 console.log('R181_REAL_PROVIDER_HUMANS_RPO_RTO_AND_PRODUCTION=NO_GO');
}
