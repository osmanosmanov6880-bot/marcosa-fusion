/**
 * R174 full PG17 and SDK CI acceptance. Must run after R173 native PG17
 * offsite restore, plus isolated R174 checkpoint SQL fixture. Original
 * source, S3 and KMS are all synthetic; only PG17 dump/restore is real.
 * The second runner gets no PG, AWS credentials or private signing keys.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {generateKeyPairSync,createHash,randomBytes} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR174ArchiveCheckpoint} from './archive-checkpoint.mjs';
import {createR174RecoveryAdmission,r174RecoveryEvidenceDigest}
 from './recovery-admission.mjs';
import {createR174DestinationKmsAudit,r174PolicyHash}
 from './destination-kms.mjs';
import {createR174OffsiteCircuit,verifyR174IncidentChain}
 from './offsite-circuit.mjs';
import {issueR173Escrow} from '../r173/offsite-escrow.mjs';

const env=process.env,fail=m=>{throw Error('R174 isolated acceptance: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const reportName='r174-disposable-readiness-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'isolated source-only GitHub Actions with no AWS/OIDC keys required');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R174_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,'second runner cannot receive PG credentials');
 const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r174-second',reportName),'utf8'));
 const expected=[
  'schemaVersion','commit','sourceBundleSha256','evidenceSha256',
  'realPostgres17CheckpointAndRlsVerified',
  'realPostgres17CasReplayAndStaleTimestampRejected',
  'realPostgres17NativeCheckpointRestoreVerified',
  'r173RealPostgresOffsiteRecoveryPassedBeforeCheckpoint',
  'genuineAwsKmsSdkV3PolicyInputs',
  'syntheticOffsiteKmsExactPolicyAudited',
  'signedEscrowAndMonotonicRecoveryAdmissionVerified',
  'sha256IncidentChainAndTwoReviewerResetVerified',
  'actualAwsConnected','actualOffsiteReplicaObserved',
  'actualAwsKmsPolicyAudited',
  'actualIndependentHumanReviewProven',
  'actualSupabaseModified','productionAuthorized'
 ].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===expected&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256&&
  H64.test(report.evidenceSha256||''),
  'source-bound nonsecret R174 evidence changed');
 for(const k of [
  'realPostgres17CheckpointAndRlsVerified',
  'realPostgres17CasReplayAndStaleTimestampRejected',
  'realPostgres17NativeCheckpointRestoreVerified',
  'r173RealPostgresOffsiteRecoveryPassedBeforeCheckpoint',
  'genuineAwsKmsSdkV3PolicyInputs',
  'syntheticOffsiteKmsExactPolicyAudited',
  'signedEscrowAndMonotonicRecoveryAdmissionVerified',
  'sha256IncidentChainAndTwoReviewerResetVerified'
 ])ok(report[k]===true,'R174 primary real PG17 test proof missing: '+k);
 for(const k of [
  'actualAwsConnected','actualOffsiteReplicaObserved',
  'actualAwsKmsPolicyAudited','actualIndependentHumanReviewProven',
  'actualSupabaseModified','productionAuthorized'
 ])ok(report[k]===false,'false real-cloud/production authorization claim');
 console.log('R174_SECOND_INDEPENDENT_RUNNER_SOURCE_AND_REPORT=PASS');
 console.log('R174_REAL_AWS_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R174_PG_CONTAINER||''),
  'actual disposable PG17 container required');
 const native=(exe,args,{input}={})=>{
  const p=spawnSync(exe,args,{input,encoding:null,
   timeout:60000,maxBuffer:40*1024*1024});
  ok(p.status===0&&!p.error,'native disposable PG17 command rejected');
  return p.stdout;
 };
 const sql=(database,stmt)=>native('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',database,'-c',stmt])
  .toString('utf8').trim();
 const queryCheckpoint=db=>{
  const v=sql(db,
   "SELECT sequence::text||'|'||source_commit||'|'||archive_sha256||'|'||escrow_sha256||'|'||evidence_sha256||'|'||archived_at_ms::text||'|'||production_authorized::text FROM r174_ci.checkpoint WHERE id=1");
  const [sequence,source_commit,archive_sha256,escrow_sha256,
   evidence_sha256,archived_at_ms,production_authorized]=v.split('|');
  return{sequence:Number(sequence),source_commit,archive_sha256,
   escrow_sha256,evidence_sha256,archived_at_ms:Number(archived_at_ms),
   production_authorized:production_authorized==='true'};
 };
 const now=Date.now(),clock=()=>now;
 const sdk=createRequire(new URL('../r170/package.json',import.meta.url));
 const KMS=sdk('@aws-sdk/client-kms');
 ok(['GetKeyPolicyCommand','DescribeKeyCommand',
  'GetKeyRotationStatusCommand','ListGrantsCommand'].every(
   k=>typeof KMS[k]==='function'),
  'official AWS SDK v3 key auditing classes missing');
 const accountId='444455556666',region='eu-central-1',
  keyArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab',
  sourceKmsArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
  role='arn:aws:iam::'+accountId+':role/marcosa-staging-backup-role';
 const condition={StringEquals:{
  'kms:EncryptionContext:marcosa-scope':'isolated-staging-only'
 }};
 const policy={Version:'2012-10-17',Statement:[
  {Sid:'StagingDecrypt',Effect:'Allow',
   Principal:{AWS:role},Action:['kms:Encrypt','kms:Decrypt'],
   Resource:'*',Condition:condition},
  {Sid:'NeverDestroy',Effect:'Deny',Principal:'*',
   Action:['kms:DisableKey','kms:ScheduleKeyDeletion'],Resource:'*'}
 ]};
 let calls=0;
 const client={send:async cmd=>{
  calls++;
  if(cmd instanceof KMS.DescribeKeyCommand)
   return{KeyMetadata:{Arn:keyArn,AWSAccountId:accountId,
    Enabled:true,KeyState:'Enabled',KeyManager:'CUSTOMER',
    Origin:'AWS_KMS',KeyUsage:'ENCRYPT_DECRYPT',
    KeySpec:'SYMMETRIC_DEFAULT',MultiRegion:false}};
  if(cmd instanceof KMS.GetKeyPolicyCommand)
   return{Policy:JSON.stringify(policy)};
  if(cmd instanceof KMS.GetKeyRotationStatusCommand)
   return{KeyRotationEnabled:true};
  if(cmd instanceof KMS.ListGrantsCommand)
   return{Grants:[],Truncated:false};
  throw Error('unsupported synthetic KMS operation');
 }};
 const kmsProof=await createR174DestinationKmsAudit({
  client,commands:KMS,keyArn,accountId,region,approvedRoleArn:role,
  approvedPolicySha256:r174PolicyHash(policy),
  clock,allowExternalCalls:true
 }).inspect();
 ok(kmsProof.checked&&calls===4&&
  kmsProof.realAwsAccountUsed===false,
  'synthetic destination KMS role policy not pinned');
 const escrowSha256=randomBytes(32).toString('hex'),
  archiveSha256=randomBytes(32).toString('hex'),
  archivedAtMs=now-60000,sequence=1;
 const evidence=r174RecoveryEvidenceDigest({
  sequence,commit,bundleSha256:bundle.sha256,archiveSha256,
  escrowSha256,offsiteKmsArn:keyArn,archivedAtMs
 });
 const writer=createR174ArchiveCheckpoint({
  executeSql:async stmt=>sql('postgres',stmt),clock
 });
 const first={expectedSequence:0,sequence,commit,archiveSha256,
  escrowSha256,evidenceSha256:evidence,archivedAtMs};
 const grant=await writer.advance(first);
 ok(grant.monotonicCheckpointAccepted&&
  grant.auditCommittedAtomically,
  'first PG17 source checkpoint CAS missing');
 let replayDenied=false;
 try{await createR174ArchiveCheckpoint({
  executeSql:async stmt=>sql('postgres',stmt),clock
 }).advance(first);}catch{replayDenied=true;}
 ok(replayDenied,'cross-process PG17 duplicate archive sequence allowed');
 let rollbackDenied=false;
 try{await writer.advance({
  ...first,expectedSequence:1,sequence:2,
  archivedAtMs:archivedAtMs-1000
 });}catch{rollbackDenied=true;}
 ok(rollbackDenied,'PG17 accepted older archive timestamp');
 const source=await queryCheckpoint('postgres');
 ok(source.sequence===1&&source.source_commit===commit&&
  source.archive_sha256===archiveSha256&&
  source.escrow_sha256===escrowSha256&&
  source.evidence_sha256===evidence&&
  source.archived_at_ms===archivedAtMs,
  'checkpoint SQL race changed the committed highwater');
 const roles=sql('postgres',
  "SELECT (NOT has_table_privilege('anon','r174_ci.checkpoint','SELECT'))::text||'|'||(NOT has_table_privilege('marcosa_r174_writer','r174_ci.checkpoint_events','DELETE'))::text||'|'||(SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid='r174_ci.checkpoint'::regclass)");
 ok(roles==='true|true|true','PG17 RLS or append-only permissions drifted');
 const signKey=generateKeyPairSync('ed25519'),encrypted=randomBytes(96);
 const signed=issueR173Escrow({
  privateKey:signKey.privateKey,clock,
  data:{commit,bundleSha256:bundle.sha256,archiveSha256,
   archiveId:randomBytes(16).toString('hex'),
   sourceVersionId:'source-r174-v1',offsiteVersionId:'replica-r174-v2',
   inventorySha256:randomBytes(32).toString('hex'),
   sourceAccountId:'111122223333',offsiteAccountId:accountId,
   sourceKmsArn,offsiteKmsArn:keyArn,
   sourceEncryptedKeySha256:randomBytes(32).toString('hex'),
   offsiteEncryptedKeySha256:createHash('sha256')
    .update(encrypted).digest('hex'),
   keyContextSha256:randomBytes(32).toString('hex'),
   offsiteEncryptedKeyBase64:encrypted.toString('base64')
  }
 });
 const admitted=await createR174RecoveryAdmission({
  readCheckpoint:async()=>queryCheckpoint('postgres'),
  readEscrow:async()=>({verified:true,sha256:escrowSha256,
   versionId:'escrow-r174-v1',receipt:signed}),
  auditOffsiteKms:async()=>kmsProof,
  clock,allowAdmission:true
 }).inspect({
  sequence,commit,bundleSha256:bundle.sha256,archiveSha256,
  escrowSha256,escrowVersionId:'escrow-r174-v1',
  archivedAtMs,offsiteAccountId:accountId,offsiteKmsArn:keyArn,
  pinnedSignerSpkiSha256:signed.signerSpkiSha256
 });
 ok(admitted.accepted&&admitted.productionAuthorized===false,
  'independent monotonic recovery admission rejected');
 let staleDenied=false;
 try{await createR174RecoveryAdmission({
  readCheckpoint:async()=>queryCheckpoint('postgres'),
  readEscrow:async()=>({verified:true,sha256:escrowSha256,
   versionId:'escrow-r174-v1',receipt:signed}),
  auditOffsiteKms:async()=>kmsProof,
  clock,allowAdmission:true
 }).inspect({
  sequence:sequence-1,commit,bundleSha256:bundle.sha256,
  archiveSha256,escrowSha256,escrowVersionId:'escrow-r174-v1',
  archivedAtMs,offsiteAccountId:accountId,offsiteKmsArn:keyArn,
  pinnedSignerSpkiSha256:signed.signerSpkiSha256
 });}catch{staleDenied=true;}
 ok(staleDenied,'non-highwater recovery accepted');
 const events=[];
 const circuit=createR174OffsiteCircuit({
  clock,record:async entry=>{
   events.push(entry);
   return{accepted:true,sha256:entry.sha256,sequence:entry.seq};
  }
 });
 await circuit.trip({
  type:'DESTINATION_KMS_POLICY_DRIFT',reason:'POLICY_CHANGED',
  commit,archiveSha256
 });
 ok(circuit.requireClosed().closed,
  'source-independent offsite incident gate did not shut');
 await circuit.acknowledgeReset({
  reason:'TWO_REVIEWERS_APPROVED',commit,archiveSha256,
  operatorApproved:true,reviewerApproved:true,
  evidenceSha256:evidence,verifiedCheckpointSha256:evidence
 });
 ok(verifyR174IncidentChain(events).count===2&&
  circuit.snapshot().productionAuthorized===false,
  'offsite incident hash chain damaged');
 // Snapshot the NEW checkpoint after successful real R173 restore.
 const dump=native('docker',['exec','-u','postgres',
  env.R174_PG_CONTAINER,'pg_dump','-U','postgres','-d','postgres',
  '--format=custom']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'native PG17 R174 checkpoint dump absent');
 try{
  sql('postgres','CREATE DATABASE marcosa_r174_restored TEMPLATE template0');
  native('docker',['exec','-u','postgres','-i',env.R174_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r174_restored',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 const back=queryCheckpoint('marcosa_r174_restored');
 const eventCount=sql('marcosa_r174_restored',
  'SELECT count(*) FROM r174_ci.checkpoint_events');
 const restoredRls=sql('marcosa_r174_restored',
  "SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid='r174_ci.checkpoint'::regclass");
 ok(back.sequence===1&&back.evidence_sha256===evidence&&
  eventCount==='1'&&restoredRls==='true',
  'native PG17 restore lost highwater/audit/RLS');
 const past=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r173-offsite-disposable-report.json'),'utf8'));
 ok(past.commit===commit&&
  past.sourceBundleSha256===bundle.sha256&&
  past.realPg17SourceNativeDumpAndRestore===true&&
  past.sourceAwsNotContactedDuringOffsiteRestore===true&&
  past.actualRealAwsAccountsUsed===false&&
  past.productionAuthorized===false,
  'R173 source-independent actual PG17 rehearsal not executed first');
 const report={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  evidenceSha256:evidence,
  realPostgres17CheckpointAndRlsVerified:true,
  realPostgres17CasReplayAndStaleTimestampRejected:true,
  realPostgres17NativeCheckpointRestoreVerified:true,
  r173RealPostgresOffsiteRecoveryPassedBeforeCheckpoint:true,
  genuineAwsKmsSdkV3PolicyInputs:true,
  syntheticOffsiteKmsExactPolicyAudited:true,
  signedEscrowAndMonotonicRecoveryAdmissionVerified:true,
  sha256IncidentChainAndTwoReviewerResetVerified:true,
  actualAwsConnected:false,actualOffsiteReplicaObserved:false,
  actualAwsKmsPolicyAudited:false,
  actualIndependentHumanReviewProven:false,
  actualSupabaseModified:false,productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,reportName),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R174_REAL_PG17_MONOTONIC_CAS_AUDIT_AND_RLS_RESTORED=PASS');
 console.log('R174_R173_REAL_PG17_OFFSITE_SOURCE_OUTAGE_INTEGRATED=PASS');
 console.log('R174_PINNED_SDK_KMS_ED25519_ESCROW_AND_INCIDENT_CHAIN=PASS');
 console.log('R174_REAL_AWS_APPROVALS_SUPABASE_AND_PRODUCTION=NO_GO');
}
