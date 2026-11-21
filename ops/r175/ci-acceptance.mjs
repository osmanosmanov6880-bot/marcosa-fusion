/**
 * R175 isolated real PostgreSQL 17 + synthetic immutable S3 anchor acceptance.
 * Earlier R173 and R174 full native backup/restore already run in this job.
 * No real AWS, source credentials, customer data, production or human approval.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {issueR175DualAnchor} from './dual-anchor.mjs';
import {createR175OffsiteAnchorStore} from './anchor-store.mjs';
import {createR175RecoveryNonce} from './recovery-nonce.mjs';
import {createR175RecoverySupervisor} from './recovery-supervisor.mjs';
import {createR174ArchiveCheckpoint} from '../r174/archive-checkpoint.mjs';
import {r174RecoveryEvidenceDigest} from '../r174/recovery-admission.mjs';
const env=process.env,fail=m=>{throw Error('R175 PG17 acceptance: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const H64=/^[a-f0-9]{64}$/;
const reportName='r175-isolated-source-anchor-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'only credential-free isolated GitHub workflow allowed');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R175_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,'second reviewer has no PostgreSQL secrets');
 const result=JSON.parse(await readFile(
  join(env.RUNNER_TEMP,'r175-second',reportName),'utf8'));
 const required=['schemaVersion','commit','bundleSha256','anchorSha256',
  'realPg17SourceR174HighwaterRls',
  'realPg17DurableR175NonceAudit',
  'realPg17RepeatedNonceDeniedAcrossConnections',
  'realPg17NativeBackupRestorePreservesR175Lease',
  'syntheticOffsiteS3ImmutableAnchorSha256Verified',
  'twoDistinctEd25519SigningKeysValidated',
  'supervisorAnchorBeforeLeaseChecked',
  'actualRealAwsAccountUsed','actualIndependentHumansVerified',
  'actualProductionRpoRtoProven','productionAuthorized']
  .sort().join(',');
 ok(result&&Object.getPrototypeOf(result)===Object.prototype&&
  Object.keys(result).sort().join(',')===required&&
  result.schemaVersion===1&&result.commit===commit&&
  result.bundleSha256===bundle.sha256&&
  H64.test(result.anchorSha256||''),
  'report bytes not SHA pinned to source and schema');
 for(const x of ['realPg17SourceR174HighwaterRls',
  'realPg17DurableR175NonceAudit',
  'realPg17RepeatedNonceDeniedAcrossConnections',
  'realPg17NativeBackupRestorePreservesR175Lease',
  'syntheticOffsiteS3ImmutableAnchorSha256Verified',
  'twoDistinctEd25519SigningKeysValidated',
  'supervisorAnchorBeforeLeaseChecked'
 ])ok(result[x]===true,'missing isolated verified evidence: '+x);
 for(const x of ['actualRealAwsAccountUsed',
  'actualIndependentHumansVerified','actualProductionRpoRtoProven',
  'productionAuthorized'
 ])ok(result[x]===false,'simulated evidence cannot prove live AWS');
 console.log('R175_SECOND_RUNNER_PINNED_SOURCE_AND_REPORT=PASS');
 console.log('R175_REAL_AWS_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R175_PG_CONTAINER||''),
  'disposable native PostgreSQL17 container missing');
 const run=(exe,args,{input}={})=>{
  const a=spawnSync(exe,args,{input,encoding:null,
   timeout:60000,maxBuffer:40*1024*1024});
  ok(a.status===0&&!a.error,'native PostgreSQL17 command failure: '+exe);
  return a.stdout;
 };
 const sql=(db,q)=>run('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',q]).toString('utf8').trim();
 const now=Date.now(),clock=()=>now;
 const archiveSha256=randomBytes(32).toString('hex');
 const escrowSha256=randomBytes(32).toString('hex');
 const offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
 const oldLine=sql('postgres',
  "SELECT sequence::text||'|'||source_commit||'|'||archive_sha256||'|'||escrow_sha256||'|'||evidence_sha256 FROM r174_ci.checkpoint WHERE id=1");
 const [previousSeq,previousCommit,previousArchive,previousEscrow,
  previousDigest]=oldLine.split('|');
 ok(Number(previousSeq)===1&&previousCommit===commit&&
  [previousArchive,previousEscrow,previousDigest].every(x=>H64.test(x)),
  'R174 genuine sequence-1 baseline required for signed parent');
 const operatorKey=generateKeyPairSync('ed25519');
 const reviewerKey=generateKeyPairSync('ed25519');
 const previousAnchor=issueR175DualAnchor({
  data:{sequence:1,commit,bundleSha256:bundle.sha256,
   archiveSha256:previousArchive,escrowSha256:previousEscrow,
   checkpointSha256:previousDigest,priorAnchorSha256:'0'.repeat(64)},
  operatorKey:operatorKey.privateKey,reviewerKey:reviewerKey.privateKey,clock
 });
 const archivedAtMs=now-60000,sequence=2;
 const checkpointSha256=r174RecoveryEvidenceDigest({sequence,commit,
  bundleSha256:bundle.sha256,archiveSha256,escrowSha256,
  offsiteKmsArn,archivedAtMs});
 const pgCheckpoint=createR174ArchiveCheckpoint({
  executeSql:async q=>sql('postgres',q),clock
 });
 ok((await pgCheckpoint.advance({
  expectedSequence:1,sequence,commit,archiveSha256,
  escrowSha256,evidenceSha256:checkpointSha256,archivedAtMs
 })).monotonicCheckpointAccepted,'R174 archive highwater missing');
 const checkpoint=()=>{
  const l=sql('postgres',
   "SELECT sequence::text||'|'||source_commit||'|'||archive_sha256||'|'||escrow_sha256||'|'||evidence_sha256||'|'||production_authorized::text FROM r174_ci.checkpoint WHERE id=1");
  const [seq,source_commit,archive_sha256,escrow_sha256,
   evidence_sha256,production_authorized]=l.split('|');
  return{sequence:Number(seq),source_commit,archive_sha256,escrow_sha256,
   evidence_sha256,production_authorized:production_authorized==='true'};
 };
 const data={sequence,commit,bundleSha256:bundle.sha256,archiveSha256,
  escrowSha256,checkpointSha256,
  priorAnchorSha256:previousAnchor.anchorSha256};
 const receipt=issueR175DualAnchor({
  data,operatorKey:operatorKey.privateKey,
  reviewerKey:reviewerKey.privateKey,clock
 });
 const accountId='444455556666',bucket='marcosa-offsite-ci-locked';
 const store=new Map();
 const constructors=Object.fromEntries(['PutObject','HeadObject','GetObject']
  .map(type=>[type+'Command',class{
   constructor(input){this.type=type;this.input=input;}
  }]));
 const client={send:async command=>{
  const i=command.input;
  ok(i.ExpectedBucketOwner===accountId&&i.Bucket===bucket,
   'offsite account and bucket pin required');
  if(command.type==='PutObject'){
   ok(i.IfNoneMatch==='*'&&!store.has(i.Key),
    'no overwrite of existing immutable object permitted');
   store.set(i.Key,{...i,VersionId:'anchor-offsite-v1',
    Body:Buffer.from(i.Body)});
   return{VersionId:'anchor-offsite-v1'};
  }
  const v=store.get(i.Key);
  ok(v&&i.VersionId===v.VersionId,'exact S3 version missing');
  if(command.type==='HeadObject')return{
   VersionId:v.VersionId,ContentLength:v.ContentLength,
   ContentType:v.ContentType,ServerSideEncryption:'aws:kms',
   SSEKMSKeyId:v.SSEKMSKeyId,ObjectLockMode:'COMPLIANCE',
   ObjectLockRetainUntilDate:v.ObjectLockRetainUntilDate,
   ChecksumSHA256:v.ChecksumSHA256};
  return{VersionId:v.VersionId,ContentLength:v.ContentLength,
   Body:Buffer.from(v.Body)};
 }};
 const anchorStore=createR175OffsiteAnchorStore({
  client,commands:constructors,bucket,accountId,kmsKeyArn:offsiteKmsArn,
  pinnedOperatorSpkiSha256:receipt.approvals[0].signerSpkiSha256,
  pinnedReviewerSpkiSha256:receipt.approvals[1].signerSpkiSha256,
  clock,allowExternalCalls:true
 });
 const previousData={
  sequence:1,commit,bundleSha256:bundle.sha256,
  archiveSha256:previousArchive,escrowSha256:previousEscrow,
  checkpointSha256:previousDigest,priorAnchorSha256:'0'.repeat(64)
 };
 const previousStored=await anchorStore.save({
  receipt:previousAnchor,expected:previousData
 });
 const previousRead=await anchorStore.read({
  sha256:previousStored.sha256,versionId:previousStored.versionId,
  expected:previousData
 });
 ok(previousRead.verified===true&&
  previousRead.receipt.anchorSha256===data.priorAnchorSha256,
  'signed R174 genesis anchor was not independently stored and reread');
 const stored=await anchorStore.save({receipt,expected:data});
 ok(stored.immutableVersionChecked,'immutable S3 anchor not verified');
 const fence=createR175RecoveryNonce({
  executeSql:async statement=>sql('postgres',statement)
 });
 const incidents=[];
 const nonce=randomBytes(16).toString('hex');
 const supervisor=createR175RecoverySupervisor({
  readCheckpoint:async()=>checkpoint(),anchorStore,recoveryNonce:fence,
  offsiteRehearsal:async()=>({
   verified:true,sourceS3AndKmsNotAccessedDuringRestore:true,
   syntheticRowsLost:0,productionAuthorized:false
  }),emergencyCircuit:{
   snapshot:()=>({stopped:true}),
   trip:async e=>{incidents.push(e);return{accepted:true};}
  },clock,allowRecovery:true
 });
 const result=await supervisor.rehearse({
  ...data,nonce,anchorSha256:stored.sha256,
  anchorVersionId:stored.versionId,
  pinnedOperatorSpkiSha256:receipt.approvals[0].signerSpkiSha256,
  pinnedReviewerSpkiSha256:receipt.approvals[1].signerSpkiSha256
 });
 ok(result.verified===true&&result.nonceCommitted===true&&
  incidents.length===0,'signed anchor and R175 PG17 CAS lease failed');
 let replayDenied=false;
 try{await createR175RecoveryNonce({
  executeSql:async q=>sql('postgres',q)
 }).consume({nonce,sequence,anchorSha256:stored.sha256,
  archiveSha256,commit});}
 catch{replayDenied=true;}
 ok(replayDenied,'second PG17 process reissued recovery nonce');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r175_ci.recovery_leases)::text||'|'||(SELECT count(*) FROM r175_ci.recovery_audit)::text");
 ok(counts('postgres')==='1|1','exactly one lease and audit required');
 const rls=sql('postgres',
  "SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid='r175_ci.recovery_leases'::regclass");
 ok(rls==='true','R175 PG17 forced RLS missing');
 const dump=run('docker',['exec','-u','postgres',env.R175_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'actual native PG17 binary dump required');
 try{
  sql('postgres','CREATE DATABASE marcosa_r175_restored TEMPLATE template0');
  run('docker',['exec','-u','postgres','-i',env.R175_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r175_restored',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 ok(counts('marcosa_r175_restored')==='1|1'&&
  sql('marcosa_r175_restored',
   "SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid='r175_ci.recovery_leases'::regclass")==='true',
  'PG17 restored lease/audit/RLS witness missing');
 let restoreReplayDenied=false;
 try{await createR175RecoveryNonce({
  executeSql:async q=>sql('marcosa_r175_restored',q)
 }).consume({nonce,sequence,anchorSha256:stored.sha256,
  archiveSha256,commit});}
 catch{restoreReplayDenied=true;}
 ok(restoreReplayDenied,'restored PostgreSQL accepted old nonce');
 const prev=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r174-disposable-readiness-report.json'),'utf8'));
 ok(prev.commit===commit&&prev.sourceBundleSha256===bundle.sha256&&
  prev.realPostgres17NativeCheckpointRestoreVerified===true&&
  prev.productionAuthorized===false,
  'prior R174 native source-independent recovery must pass');
 const report={schemaVersion:1,commit,bundleSha256:bundle.sha256,
  anchorSha256:stored.sha256,
  realPg17SourceR174HighwaterRls:true,
  realPg17DurableR175NonceAudit:true,
  realPg17RepeatedNonceDeniedAcrossConnections:true,
  realPg17NativeBackupRestorePreservesR175Lease:true,
  syntheticOffsiteS3ImmutableAnchorSha256Verified:true,
  twoDistinctEd25519SigningKeysValidated:true,
  supervisorAnchorBeforeLeaseChecked:true,
  actualRealAwsAccountUsed:false,actualIndependentHumansVerified:false,
  actualProductionRpoRtoProven:false,productionAuthorized:false};
 await writeFile(join(env.RUNNER_TEMP,reportName),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R175_REAL_PG17_ATOMIC_NONCE_AND_RESTORED_RLS=PASS');
 console.log('R175_SIGNED_OFFSITE_S3_ANCHOR_AND_SUPERVISOR=PASS');
 console.log('R175_REAL_AWS_OR_PRODUCTION_AUTHORIZED=NO_GO');
}
