/**
 * R178 exact-source, two-job GitHub Actions native PG17 audit acceptance.
 * Real disposable PostgreSQL; AWS official SDK command classes with
 * INJECTED synthetic STS/S3 answers and encrypted fixture only.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createHash,createCipheriv,randomBytes} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR178DualIdentityAudit} from './identity-audit.mjs';
import {createR178ReplicaAudit} from './replica-audit.mjs';
import {buildR178ReadOnlyIamBlueprint} from './iam-plan.mjs';
import {createR178ReadinessGate} from './readiness-gate.mjs';
import {createR178StagingLedger} from './staging-ledger.mjs';
const env=process.env,fail=m=>{throw Error('R178 native CI: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const file='r178-isolated-staging-evidence.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'real AWS, customer PostgreSQL or OIDC access forbidden by CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const sourceSpec={accountId:'111122223333',region:'eu-west-1',
 bucket:'marcosa-source-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
const offsiteSpec={accountId:'444455556666',region:'eu-central-1',
 bucket:'marcosa-offsite-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
const digestProof=p=>{
 const {evidenceSha256,decision,...plain}=p;
 return sha(Buffer.from(JSON.stringify(plain)));
};
if(env.R178_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R178_PG_CONTAINER,
  'second runner cannot access source PostgreSQL or AWS');
 const result=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r178-second',file),'utf8'));
 const keys=['schemaVersion','commit','bundleSha256',
  'historyRootSha256','probeSha256','sourceAccountId',
  'offsiteAccountId','readinessEvidenceSha256','readinessProof',
  'realPg17ImmutableLedgerAndRls','realPg17NativeRestoreAudit',
  'realPg17CrossProcessReplayDenied','syntheticDualStsResponses',
  'syntheticS3CiphertextReadback',
  'actualRealAwsAccountsUsed','actualHumanApprovalsVerified',
  'productionAuthorized'].sort().join(',');
 ok(result&&Object.getPrototypeOf(result)===Object.prototype&&
  Object.keys(result).sort().join(',')===keys&&
  result.schemaVersion===1&&result.commit===commit&&
  result.bundleSha256===bundle.sha256&&
  H64.test(result.historyRootSha256||'')&&
  H64.test(result.probeSha256||'')&&
  result.sourceAccountId===sourceSpec.accountId&&
  result.offsiteAccountId===offsiteSpec.accountId,
  'independent runner source, scope or report schema mismatch');
 const p=result.readinessProof;
 ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
  p.decision==='CI_SIMULATION_COMPLETE'&&
  p.scope==='isolated-read-only-staging-simulation'&&
  p.commit===commit&&p.bundleSha256===bundle.sha256&&
  p.historyRootSha256===result.historyRootSha256&&
  p.probeSha256===result.probeSha256&&
  p.sourceAccountId===result.sourceAccountId&&
  p.offsiteAccountId===result.offsiteAccountId&&
  p.productionAuthorized===false&&
  p.actualAwsAccountsIndependentlyVerified===false&&
  p.syntheticCiScopeOnly===true&&
  p.realIamPolicyApplied===false&&
  p.humanApprovalVerified===false&&
  p.verifiedPg17ReadbackTwice===true&&
  p.evidenceSha256===result.readinessEvidenceSha256&&
  H64.test(p.evidenceSha256||'')&&
  digestProof(p)===p.evidenceSha256,
  'the independent runner rejects altered or elevated staging evidence');
 for(const k of ['realPg17ImmutableLedgerAndRls',
  'realPg17NativeRestoreAudit','realPg17CrossProcessReplayDenied',
  'syntheticDualStsResponses','syntheticS3CiphertextReadback'])
  ok(result[k]===true,'missing native/synthetic isolation witness: '+k);
 for(const k of ['actualRealAwsAccountsUsed','actualHumanApprovalsVerified',
  'productionAuthorized'])
  ok(result[k]===false,'synthetic tests cannot prove real provider or production');
 console.log('R178_SECOND_RUNNER_SOURCE_REPORT_AND_NO_GO=PASS');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R178_PG_CONTAINER||'')&&
  /^[0-9]{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'disposable native PG17 container and CI run identifier required');
 const run=(cmd,args,{input}={})=>{
  const p=spawnSync(cmd,args,{input,encoding:null,timeout:60000,
   maxBuffer:40*1024*1024});
  ok(p.status===0&&!p.error,'native disposable operation failed: '+cmd);
  return p.stdout;
 };
 const sql=(db,query)=>run('psql',['-X','-A','-t','-v',
  'ON_ERROR_STOP=1','-d',db,'-c',query]).toString('utf8').trim();
 const past=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r177-isolated-native-history-report.json'),'utf8'));
 ok(past.commit===commit&&past.sourceBundleSha256===bundle.sha256&&
  past.realPg17AppendOnlyOutcomeAfterRestore===true&&
  past.realPg17SecondDumpRestoresAuditAndPreventsReplay===true&&
  past.productionAuthorized===false,
  'R177 native two-restore and append-only outcome acceptance required');
 const readPg=async()=>{
  const row=sql('postgres',
   "SELECT c.sequence::text||'|'||c.source_commit||'|'||"+
   "c.archive_sha256||'|'||c.evidence_sha256||'|'||"+
   "r.root_sha256||'|'||r.latest_object_sha256||'|'||"+
   "o.nonce||'|'||o.restored_state_sha256||'|'||"+
   "c.production_authorized::text FROM r174_ci.checkpoint c "+
   "JOIN r177_ci.roots r ON r.sequence=c.sequence "+
   "JOIN r177_ci.outcomes o ON o.sequence=c.sequence WHERE c.id=1")
   .split('|');
  ok(row.length===9,'independent native PG17 source/highwater missing');
  return{sequence:Number(row[0]),commit:row[1],
   bundleSha256:bundle.sha256,archiveSha256:row[2],
   checkpointSha256:row[3],historyRootSha256:row[4],
   latestObjectSha256:row[5],nonce:row[6],
   restoredStateSha256:row[7],productionAuthorized:row[8]==='true'};
 };
 const pg=await readPg();
 ok(pg.sequence===3&&pg.commit===commit&&
  pg.historyRootSha256===past.historyRootSha256&&
  pg.restoredStateSha256===past.restoredStateSha256&&
  pg.productionAuthorized===false,
  'R177 native latest audit and independent source report drifted');
 const sourceRole='AROA'+'A'.repeat(16),offsiteRole='AROA'+'B'.repeat(16);
 const runId=env.GITHUB_RUN_ID;
 const requireSdk=createRequire(new URL('../r170/package.json',import.meta.url));
 const STS=requireSdk('@aws-sdk/client-sts');
 const S3=requireSdk('@aws-sdk/client-s3');
 const stm=spec=>({
  ...spec,roleId:spec.accountId===sourceSpec.accountId?sourceRole:offsiteRole,
  client:{send:async cmd=>{
   ok(cmd instanceof STS.GetCallerIdentityCommand,
    'only STS GetCallerIdentity may be issued');
   const roleId=spec.accountId===sourceSpec.accountId?sourceRole:offsiteRole;
   return{Account:spec.accountId,Arn:'arn:aws:sts::'+spec.accountId+
    ':assumed-role/marcosa-r178-readonly-auditor/marcosa-r178-'+runId,
    UserId:roleId+':marcosa-r178-'+runId};
  }}
 });
 const fixedNow=Date.now(),clock=()=>fixedNow;
 const identityAudit=createR178DualIdentityAudit({
  source:stm(sourceSpec),offsite:stm(offsiteSpec),commands:STS,
  runId,commit,bundleSha256:bundle.sha256,
  clock,allowExternalCalls:true});
 // This probe is NOT the actual R174 ciphertext. It verifies the S3
 // encryption/retention/readback algorithm with fully synthetic responses.
 const aesKey=randomBytes(32),iv=randomBytes(12);
 const cipher=createCipheriv('aes-256-gcm',aesKey,iv);
 const encryptedProbe=Buffer.concat([
  iv,cipher.update(Buffer.alloc(1024,0x5a)),cipher.final(),cipher.getAuthTag()
 ]);
 aesKey.fill(0);
 ok(encryptedProbe.length===1052,'ephemeral AES-256-GCM encrypted probe missing');
 const probeSha256=sha(encryptedProbe),historyRootSha256=pg.historyRootSha256;
 const sourceVersionId='source-r178-'+runId,
  offsiteVersionId='offsite-r178-'+runId;
 const checksum=Buffer.from(probeSha256,'hex').toString('base64');
 let simulatedS3Requests=0;
 const s3Fixture=(spec,versionId)=>({
  ...spec,client:{send:async cmd=>{
   simulatedS3Requests++;
   const i=cmd.input;
   ok(i.ExpectedBucketOwner===spec.accountId&&i.Bucket===spec.bucket,
    'exact AWS account owner and bucket must be supplied');
   if(cmd instanceof S3.GetBucketVersioningCommand)return{Status:'Enabled'};
   if(cmd instanceof S3.GetObjectLockConfigurationCommand)return{
    ObjectLockConfiguration:{ObjectLockEnabled:'Enabled'}};
   if(cmd instanceof S3.GetPublicAccessBlockCommand)return{
    PublicAccessBlockConfiguration:{BlockPublicAcls:true,
     IgnorePublicAcls:true,BlockPublicPolicy:true,
     RestrictPublicBuckets:true}};
   if(cmd instanceof S3.HeadObjectCommand)return{
    VersionId:versionId,ContentLength:encryptedProbe.length,
    ContentType:'application/vnd.marcosa.r178-encrypted-archive',
    ServerSideEncryption:'aws:kms',SSEKMSKeyId:spec.kmsKeyArn,
    ObjectLockMode:'COMPLIANCE',
    ObjectLockRetainUntilDate:new Date(clock()+8*86400000),
    ChecksumSHA256:checksum,Metadata:{
     'marcosa-commit':commit,'marcosa-bundle-sha256':bundle.sha256,
     'marcosa-history-root-sha256':historyRootSha256}};
   if(cmd instanceof S3.GetObjectRetentionCommand)return{
    Retention:{Mode:'COMPLIANCE',RetainUntilDate:new Date(clock()+8*86400000)}};
   if(cmd instanceof S3.GetObjectCommand)return{
    VersionId:versionId,ContentLength:encryptedProbe.length,
    ChecksumSHA256:checksum,Body:Buffer.from(encryptedProbe)};
   fail('unknown or mutating S3 SDK command used in read-only audit');
  }}
 });
 const replicaAudit=createR178ReplicaAudit({
  source:s3Fixture(sourceSpec,sourceVersionId),
  offsite:s3Fixture(offsiteSpec,offsiteVersionId),commands:S3,
  clock,allowExternalCalls:true});
 const blueprint=buildR178ReadOnlyIamBlueprint({
  source:sourceSpec,offsite:offsiteSpec});
 const gate=createR178ReadinessGate({
  readPostgres:readPg,identityAudit,replicaAudit,
  iamBlueprint:blueprint,source:sourceSpec,offsite:offsiteSpec,
  clock,allowEvaluate:true});
 const proof=await gate.inspect({commit,bundleSha256:bundle.sha256,
  historyRootSha256,probeSha256,sourceVersionId,offsiteVersionId});
 ok(proof.decision==='CI_SIMULATION_COMPLETE'&&
  proof.productionAuthorized===false&&
  simulatedS3Requests===12,
  'full independent source/offsite synthetic versioned S3 audit missing');
 const writer=createR178StagingLedger({
  executeSql:async command=>sql('postgres',command)});
 ok((await writer.record(proof)).recorded,
  'atomic PG17 evidence was not persisted after independent review');
 const sqlCount=db=>sql(db,
  "SELECT (SELECT count(*) FROM r178_ci.staging_evidence)::text||'|'||"+
  "(SELECT count(*) FROM r178_ci.staging_audit)::text");
 ok(sqlCount('postgres')==='1|1','exactly one staging row and immutable audit');
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
   "WHERE oid='r178_ci.staging_evidence'::regclass)::text||'|'||"+
   "(NOT has_table_privilege('authenticated','r178_ci.staging_evidence','SELECT'))::text||'|'||"+
   "(NOT has_table_privilege('marcosa_r178_writer','r178_ci.staging_audit','UPDATE'))::text");
 ok(roles('postgres')==='true|true|true','real PG17 FORCE RLS or roles drifted');
 let replay=false;
 try{await createR178StagingLedger({
  executeSql:async q=>sql('postgres',q)
 }).record(proof);}catch{replay=true;}
 ok(replay,'independent SQL session reinserted prior staging evidence');
 const dump=run('docker',['exec','-u','postgres',env.R178_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'native PG17 custom backup missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r178_verified TEMPLATE template0');
  run('docker',['exec','-u','postgres','-i',env.R178_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r178_verified',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 ok(sqlCount('marcosa_r178_verified')==='1|1'&&
  roles('marcosa_r178_verified')==='true|true|true',
  'restored native PostgreSQL17 lost immutable readiness or RLS');
 replay=false;
 try{await createR178StagingLedger({
  executeSql:async q=>sql('marcosa_r178_verified',q)
 }).record(proof);}catch{replay=true;}
 ok(replay,'restored PostgreSQL17 accepted duplicate staging evidence');
 const report={schemaVersion:1,commit,bundleSha256:bundle.sha256,
  historyRootSha256,probeSha256,
  sourceAccountId:sourceSpec.accountId,offsiteAccountId:offsiteSpec.accountId,
  readinessEvidenceSha256:proof.evidenceSha256,readinessProof:proof,
  realPg17ImmutableLedgerAndRls:true,realPg17NativeRestoreAudit:true,
  realPg17CrossProcessReplayDenied:true,
  syntheticDualStsResponses:true,syntheticS3CiphertextReadback:true,
  actualRealAwsAccountsUsed:false,actualHumanApprovalsVerified:false,
  productionAuthorized:false};
 await writeFile(join(env.RUNNER_TEMP,file),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R178_REAL_PG17_IMMUTABLE_STAGING_WITNESS=PASS');
 console.log('R178_SYNTHETIC_TWO_ACCOUNT_STS_S3_FULL_SHA=PASS');
 console.log('R178_REAL_AWS_HUMAN_REVIEW_AND_PRODUCTION=NO_GO');
}
