/**
 * R173 cross-account offsite-only DR rehearsal on actual disposable PG17.
 * Native source PGDMP, original KMS AES-256 DEK, independently wrapped
 * destination KMS DEK, signed pinned offsite escrow with Object Lock,
 * original + replicated ciphertext S3 SHA256, then hard-disable source
 * AWS dependencies and restore using destination ONLY.
 *
 * GitHub CI uses genuine SDK v3 command classes, injected in-process fake
 * AWS service responses (never AWS network/credentials/customer records).
 */
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,
 createCipheriv,createDecipheriv,sign} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {readR167FixtureInventory} from '../r167/pg-witness.mjs';
import {createR168SimulatedAws} from '../r168/mock-aws.mjs';
import {createR168AwsKmsAdapter,r168KmsContext} from '../r168/aws-kms.mjs';
import {createR168AwsS3Adapter} from '../r168/aws-s3.mjs';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR171PostgresFence} from '../r171/pg-fence.mjs';
import {createR173OffsiteObject} from './offsite-object.mjs';
import {createR173OffsiteKmsBridge} from './offsite-kms.mjs';
import {issueR173Escrow,createR173OffsiteEscrowStore}
 from './offsite-escrow.mjs';
import {createR173OffsiteRecovery,r173OffsiteTargetDigest}
 from './offsite-recovery.mjs';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';

const env=process.env,fail=m=>{throw Error('R173 isolated PG17: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[0-9a-f]{40}$/,H64=/^[0-9a-f]{64}$/;
const reportName='r173-offsite-disposable-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'only credential-free GitHub CI checkout');
const commit=env.GITHUB_SHA;
const sourceBundle=await buildR163Bundle({root:process.cwd(),commit});
const hash=x=>createHash('sha256').update(x).digest('hex');
if(env.R173_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,
  'second runner must not receive PostgreSQL or KMS credentials');
 const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r173-second',reportName),'utf8'));
 const expected=[
  'schemaVersion','commit','sourceBundleSha256',
  'offsiteCiphertextSha256','offsiteEscrowSha256',
  'offsiteVersionId','offsiteEscrowVersionId','syntheticRtoMs',
  'realPg17SourceNativeDumpAndRestore',
  'realPg17RestoredRlsAndSessions',
  'realPg17DualNonceAndAuditReplayDenied',
  'officialAwsS3KmsV3CommandConstructorsUsed',
  'sourceAndOffsiteS3CiphertextCompared',
  'secondKmsEncryptedDataKeyUsedInRestore',
  'signedImmutableDestinationEscrowVerified',
  'sourceAwsNotContactedDuringOffsiteRestore',
  'twoDistinctEd25519ReviewerKeysVerified',
  'actualRealAwsAccountsUsed','actualHumanApprovalsVerified',
  'actualCrossAccountReplicationObserved',
  'actualOffsiteAwsKmsPolicyIndependentlyAudited',
  'actualProductionRpoRtoProven','hostedSupabaseChanged',
  'productionAuthorized'
 ].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===expected&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===sourceBundle.sha256&&
  H64.test(report.offsiteCiphertextSha256||'')&&
  H64.test(report.offsiteEscrowSha256||'')&&
  Number.isSafeInteger(report.syntheticRtoMs)&&
  report.syntheticRtoMs>=0&&report.syntheticRtoMs<=120000&&
  /^[A-Za-z0-9_.-]{1,128}$/.test(report.offsiteVersionId||'')&&
  /^[A-Za-z0-9_.-]{1,128}$/.test(report.offsiteEscrowVersionId||''),
  'exact SHA-pinned finite nonsecret offsite report required');
 for(const k of [
  'realPg17SourceNativeDumpAndRestore',
  'realPg17RestoredRlsAndSessions',
  'realPg17DualNonceAndAuditReplayDenied',
  'officialAwsS3KmsV3CommandConstructorsUsed',
  'sourceAndOffsiteS3CiphertextCompared',
  'secondKmsEncryptedDataKeyUsedInRestore',
  'signedImmutableDestinationEscrowVerified',
  'sourceAwsNotContactedDuringOffsiteRestore',
  'twoDistinctEd25519ReviewerKeysVerified'
 ])ok(report[k]===true,'offsite test proof absent: '+k);
 for(const k of [
  'actualRealAwsAccountsUsed','actualHumanApprovalsVerified',
  'actualCrossAccountReplicationObserved',
  'actualOffsiteAwsKmsPolicyIndependentlyAudited',
  'actualProductionRpoRtoProven','hostedSupabaseChanged',
  'productionAuthorized'
 ])ok(report[k]===false,'false claim of real AWS/production: '+k);
 console.log('R173_SECOND_RUNNER_SOURCE_BUNDLE_AND_NONSECRET_REPORT=PASS');
 console.log('R173_REAL_AWS_OFFSITE_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[0-9a-f]{12,64}$/.test(env.R173_PG_CONTAINER||''),
  'only disposable PostgreSQL 17 service Docker id');
 const run=(exe,args,{input}={})=>{
  const p=spawnSync(exe,args,{input,encoding:null,
   timeout:60000,maxBuffer:40*1024*1024});
  ok(p.status===0&&!p.error,'native PG17 command failed: '+exe);
  return p.stdout;
 };
 const sql=(db,q)=>run('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',q]).toString('utf8').trim();
 const clock=()=>Date.now();
 const sdk=createRequire(new URL('../r170/package.json',import.meta.url));
 const S3=sdk('@aws-sdk/client-s3'),KMS=sdk('@aws-sdk/client-kms');
 ok(['HeadObjectCommand','GetObjectCommand','PutObjectCommand'].every(
  x=>typeof S3[x]==='function')&&
  ['EncryptCommand','DecryptCommand'].every(
  x=>typeof KMS[x]==='function'),
  'genuine official AWS SDK v3 S3/KMS class constructors required');
 const sourceAccountId='111122223333',offsiteAccountId='444455556666',
  sourceRegion='eu-west-1',offsiteRegion='eu-central-1',
  sourceBucket='marcosa-ci-locked',offsiteBucket='marcosa-offsite-ci-locked',
  offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
 const mock=createR168SimulatedAws({clock});
 const sourceKmsArn=mock.keyArn;
 ok(mock.accountId===sourceAccountId&&mock.region===sourceRegion,
  'fixture source KMS/S3 identity changed');
 // Control database is cloned BEFORE backup nonce, remains independent.
 sql('postgres','CREATE DATABASE marcosa_r173_control TEMPLATE postgres');
 const nonce=randomBytes(16).toString('hex');
 const archiveId=randomBytes(16).toString('hex');
 const roleArn='arn:aws:iam::'+offsiteAccountId+
  ':role/marcosa-staging-backup-role';
 const inventory=await readR167FixtureInventory({
  sqlRead:async q=>sql('postgres',q)
 });
 const inventorySha256=hash(Buffer.from(JSON.stringify(inventory)));
 const fenceInput={nonce,commit,archiveSha256:'a'.repeat(64),
  reviewerDigest:'b'.repeat(64),roleArn};
 const sourceFence=createR171PostgresFence({
  executeSql:async q=>sql('postgres',q),clock
 });
 ok((await sourceFence.consume(fenceInput)).consumedExactlyOnce,
  'source nonce not committed before snapshot');
 const raw=run('docker',['exec','-u','postgres',env.R173_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','--format=custom']);
 ok(raw.subarray(0,5).toString('utf8')==='PGDMP'&&raw.length>=512,
  'native PostgreSQL17 source archive required');
 let sourceDisabled=false,sourceCallsAfterShutdown=0;
 const sourceKms=createR168AwsKmsAdapter({
  client:mock.kmsClient,commands:mock.commands,
  keyArn:sourceKmsArn,region:sourceRegion,accountId:sourceAccountId,
  allowExternalCalls:true,clock
 });
 const sourceS3=createR168AwsS3Adapter({
  client:mock.s3Client,commands:mock.commands,
  bucket:sourceBucket,region:sourceRegion,accountId:sourceAccountId,
  kmsKeyArn:sourceKmsArn,allowExternalCalls:true,clock
 });
 const destCmk=randomBytes(32),destCalls=[];
 const destKmsClient={send:async cmd=>{
  destCalls.push(cmd.constructor.name);
  if(cmd instanceof KMS.EncryptCommand){
   ok(cmd.input.KeyId===offsiteKmsArn,'destination KMS encryption key mismatch');
   const iv=randomBytes(12);
   const cipher=createCipheriv('aes-256-gcm',destCmk,iv);
   cipher.setAAD(Buffer.from(JSON.stringify(cmd.input.EncryptionContext)));
   return{KeyId:offsiteKmsArn,
    CiphertextBlob:Buffer.concat([iv,cipher.update(cmd.input.Plaintext),
     cipher.final(),cipher.getAuthTag(),randomBytes(48)])};
  }
  if(cmd instanceof KMS.DecryptCommand){
   ok(cmd.input.KeyId===offsiteKmsArn,
    'destination KMS decryption key mismatch');
   const enc=Buffer.from(cmd.input.CiphertextBlob);
   const decipher=createDecipheriv('aes-256-gcm',destCmk,enc.subarray(0,12));
   decipher.setAAD(Buffer.from(JSON.stringify(cmd.input.EncryptionContext)));
   decipher.setAuthTag(enc.subarray(44,60));
   return{KeyId:offsiteKmsArn,
    Plaintext:Buffer.concat([decipher.update(enc.subarray(12,44)),
     decipher.final()])};
  }
  throw Error('unknown destination KMS operation');
 }};
 const offsiteKms=createR173OffsiteKmsBridge({
  offsiteClient:destKmsClient,commands:KMS,
  sourceKmsArn,offsiteKmsArn,allowExternalCalls:true,clock
 });
 let sourceKey,offsiteKey, sealed,sourceVersionId,sourceHead;
 try{
  sourceKey=await sourceKms.issue({
   commit,bundleSha256:sourceBundle.sha256,archiveId
  });
  offsiteKey=await offsiteKms.wrap({
   plaintextKey:sourceKey.plaintextKey,
   sourceEncryptedKey:sourceKey.encryptedKey,
   commit,bundleSha256:sourceBundle.sha256,archiveId
  });
  sealed=sealR165Backup({
   plaintext:raw,key:sourceKey.plaintextKey,
   commit,bundleSha256:sourceBundle.sha256,createdAtMs:clock()
  });
  const put=await sourceS3.put({
   blob:sealed.blob,commit,bundleSha256:sourceBundle.sha256,archiveId,
   encryptedKey:sourceKey.encryptedKey,
   contextSha256:offsiteKey.keyContextSha256
  });
  ok(put.sha256===sealed.encryptedSha256&&put.complianceObjectLockVerified,
   'source S3 immutable object receipt not verified');
  sourceVersionId=put.versionId;
  sourceHead=await sourceS3.inspect({
   sha256:put.sha256,versionId:sourceVersionId
  });
 }finally{
  if(sourceKey?.plaintextKey)sourceKey.plaintextKey.fill(0);
  raw.fill(0);
 }
 const sha256=sealed.encryptedSha256,offsiteVersionId='r173-offsite-version-77';
 // In-process replication test: exact ciphertext bytes and *metadata*
 // copied to another account, while S3 SSE-KMS is independently re-encrypted.
 const replicaBlob=Buffer.from(sealed.blob),replicaMetadata={
  ...sourceHead.Metadata
 };
 const sourceClient={send:async cmd=>{
  if(sourceDisabled){sourceCallsAfterShutdown++;throw Error('SOURCE DOWN');}
  const input=cmd.input;
  if(cmd instanceof S3.HeadObjectCommand){
   const result=await mock.s3Client.send(
    new mock.commands.HeadObjectCommand(input));
   return{...result,ReplicationStatus:'COMPLETED'};
  }
  if(cmd instanceof S3.GetObjectCommand){
   return await mock.s3Client.send(
    new mock.commands.GetObjectCommand(input));
  }
  throw Error('source-only S3 operation rejected');
 }};
 const offsiteClient={send:async cmd=>{
  const i=cmd.input;
  ok(i.ExpectedBucketOwner===offsiteAccountId&&
   i.Bucket===offsiteBucket&&
   i.VersionId===offsiteVersionId&&
   i.Key==='marcosa/isolated/r168/'+sha256+'.r165enc',
   'offsite S3 versioned request not scoped');
  if(cmd instanceof S3.HeadObjectCommand)return{
   VersionId:offsiteVersionId,
   ContentType:'application/vnd.marcosa.r165enc',
   ContentLength:replicaBlob.length,
   ServerSideEncryption:'aws:kms',
   SSEKMSKeyId:offsiteKmsArn,
   ReplicationStatus:'REPLICA',
   ObjectLockMode:'COMPLIANCE',
   ObjectLockRetainUntilDate:new Date(clock()+8*86400000),
   ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64'),
   Metadata:replicaMetadata
  };
  if(cmd instanceof S3.GetObjectCommand)return{
   VersionId:offsiteVersionId,
   ContentType:'application/vnd.marcosa.r165enc',
   ContentLength:replicaBlob.length,
   Body:Buffer.from(replicaBlob)
  };
  throw Error('unexpected offsite S3 data operation');
 }};
 const offsiteObject=createR173OffsiteObject({
  sourceClient,offsiteClient,commands:S3,
  sourceAccountId,offsiteAccountId,sourceRegion,offsiteRegion,
  sourceBucket,offsiteBucket,sourceKmsArn,offsiteKmsArn,
  allowExternalCalls:true,clock
 });
 const data={sha256,sourceVersionId,offsiteVersionId,
  commit,bundleSha256:sourceBundle.sha256,archiveId,
  contextSha256:offsiteKey.keyContextSha256};
 const first=await offsiteObject.read({...data,compareSource:true});
 ok(first.crossAccountCiphertextReadbackVerified&&first.sourceComparedThisRun,
  'independent source/offsite identical full ciphertext not verified');
 const escrowPrivate=generateKeyPairSync('ed25519');
 const receipt=issueR173Escrow({
  data:{commit,bundleSha256:sourceBundle.sha256,archiveId,
   archiveSha256:sha256,sourceVersionId,offsiteVersionId,
   inventorySha256,sourceAccountId,offsiteAccountId,
   sourceKmsArn,offsiteKmsArn,
   sourceEncryptedKeySha256:offsiteKey.sourceEncryptedKeySha256,
   offsiteEncryptedKeySha256:offsiteKey.offsiteEncryptedKeySha256,
   keyContextSha256:offsiteKey.keyContextSha256,
   offsiteEncryptedKeyBase64:offsiteKey.encryptedKey.toString('base64')
  },privateKey:escrowPrivate.privateKey,clock
 });
 const escrowEntries=new Map();
 const escrowClient={send:async cmd=>{
  const i=cmd.input;
  ok(i.ExpectedBucketOwner===offsiteAccountId&&i.Bucket===offsiteBucket&&
   i.Key.startsWith('marcosa/isolated/r173/escrow/'),
   'escrow must be written only to offsite S3 account');
  if(cmd instanceof S3.PutObjectCommand){
   ok(i.IfNoneMatch==='*'&&i.SSEKMSKeyId===offsiteKmsArn&&
    i.ObjectLockMode==='COMPLIANCE','escrow write needs immutable object lock');
   if(escrowEntries.has(i.Key))throw Error('S3 PreconditionFailed 412');
   escrowEntries.set(i.Key,{...i,Body:Buffer.from(i.Body),
    VersionId:'r173-escrow-version-19'});
   return{VersionId:'r173-escrow-version-19'};
  }
  const value=escrowEntries.get(i.Key);
  if(!value)throw Error('missing escrow');
  if(cmd instanceof S3.HeadObjectCommand)return{
   VersionId:value.VersionId,ContentLength:value.ContentLength,
   ContentType:value.ContentType,ServerSideEncryption:value.ServerSideEncryption,
   SSEKMSKeyId:value.SSEKMSKeyId,ObjectLockMode:value.ObjectLockMode,
   ObjectLockRetainUntilDate:value.ObjectLockRetainUntilDate,
   ChecksumSHA256:value.ChecksumSHA256
  };
  if(cmd instanceof S3.GetObjectCommand)return{
   VersionId:value.VersionId,ContentLength:value.ContentLength,
   Body:Buffer.from(value.Body)
  };
  throw Error('unrecognized offsite escrow operation');
 }};
 const escrow=createR173OffsiteEscrowStore({
  client:escrowClient,commands:S3,accountId:offsiteAccountId,
  bucket:offsiteBucket,kmsKeyArn:offsiteKmsArn,
  pinnedSignerSpkiSha256:receipt.signerSpkiSha256,
  clock,allowExternalCalls:true
 });
 const saved=await escrow.save({receipt});
 ok(saved.verifiedS3EscrowStorage,
  'offsite signed escrow not durably versioned in mock S3');
 const digest=r173OffsiteTargetDigest({
  commit,bundleSha256:sourceBundle.sha256,archiveSha256:sha256,
  sourceInventorySha256:inventorySha256,
  escrowSha256:saved.sha256,escrowVersionId:saved.versionId,
  offsiteAccountId,offsiteKmsArn
 });
 const packet=createR164DrillChallenge({
  commit,targetDigest:digest,nonce,clock
 });
 const reviewers=['operator','independent-reviewer'].map(role=>{
  const k=generateKeyPairSync('ed25519');
  return{role,privateKey:k.privateKey,
   publicKeyPem:k.publicKey.export({type:'spki',format:'pem'})};
 });
 const approvals=reviewers.map(x=>({
  role:x.role,publicKeyPem:x.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),x.privateKey)
   .toString('base64url')
 }));
 const pinnedReviewerFingerprints=Object.fromEntries(reviewers.map(x=>[
  x.role,r164ReviewerFingerprint(x.publicKeyPem)
 ]));
 // Simulated loss of source cloud: from this line, no source AWS read or
 // source KMS unwrap is allowed/needed for recovery.
 sourceDisabled=true;
 const controlFence=createR171PostgresFence({
  executeSql:async q=>sql('marcosa_r173_control',q),clock
 });
 const readRestoredInventory=async({database})=>
  readR167FixtureInventory({sqlRead:async q=>sql(database,q)});
 const quarantine={status:async()=>{
  const response=sql('marcosa_r173_control',
   "SELECT closed::text||'|'||generation::text FROM r167_ci.r167_quarantine WHERE id=1");
  const [closed,generation]=response.split('|');
  return{closed:closed==='true',generation:Number(generation)};
 }};
 const restore=createR173OffsiteRecovery({
  offsiteObject,escrowStore:escrow,offsiteKms,quarantine,
  consumeNonce:async a=>{
   // SQL R171 fence has its own audit with the exact same signed nonce.
   return controlFence.consume(a);
  },
  restoreNativePg:async({database,plaintext,productionAuthorized})=>{
   ok(database==='marcosa_r168_restored'&&productionAuthorized===false,
    'only exact second disposable PG17 restore database permitted');
   sql('postgres','CREATE DATABASE marcosa_r168_restored TEMPLATE template0');
   run('docker',['exec','-u','postgres','-i',env.R173_PG_CONTAINER,
    'pg_restore','-U','postgres','-d',database,
    '--no-owner','--exit-on-error'],{input:plaintext});
   return{success:true,database};
  },
  readRestoredInventory,
  verifyRestoredNonceReplay:async({database})=>{
   let denied=false;
   try{await createR171PostgresFence({
    executeSql:async q=>sql(database,q),clock
   }).consume(fenceInput);}catch{denied=true;}
   const text=sql(database,
    "SELECT (SELECT count(*) FROM r171_ci.fenced_runs)::text||'|'||(SELECT count(*) FROM r171_ci.fenced_audit)::text");
   const [rowCount,auditCount]=text.split('|').map(Number);
   return{denied,rowCount,auditCount};
  },
  allowRecovery:true,clock,maxRestoreMs:120000
 });
 const proof=await restore.rehearse({
  commit,bundleSha256:sourceBundle.sha256,archiveSha256:sha256,
  sourceInventory:inventory,
  escrowSha256:saved.sha256,escrowVersionId:saved.versionId,
  offsiteAccountId,offsiteKmsArn,
  pinnedSignerSpkiSha256:receipt.signerSpkiSha256,
  packet,approvals,pinnedReviewerFingerprints
 });
 ok(proof.verified===true&&
  proof.sourceS3AndKmsNotAccessedDuringRestore===true&&
  sourceCallsAfterShutdown===0&&
  destCalls.includes('EncryptCommand')&&destCalls.includes('DecryptCommand')&&
  proof.syntheticRowsLost===0,
  'offsite-only PG17 restore or KMS/cryptographic independence failed');
 const countControl=sql('marcosa_r173_control',
  "SELECT (SELECT count(*) FROM r171_ci.fenced_runs)::text||'|'||(SELECT count(*) FROM r171_ci.fenced_audit)::text");
 ok(countControl==='1|1','independent SQL recovery nonce was not durably fenced');
 const report={
  schemaVersion:1,commit,sourceBundleSha256:sourceBundle.sha256,
  offsiteCiphertextSha256:sha256,offsiteEscrowSha256:saved.sha256,
  offsiteVersionId,offsiteEscrowVersionId:saved.versionId,
  syntheticRtoMs:proof.observedSyntheticOffsiteRecoveryMs,
  realPg17SourceNativeDumpAndRestore:true,
  realPg17RestoredRlsAndSessions:true,
  realPg17DualNonceAndAuditReplayDenied:true,
  officialAwsS3KmsV3CommandConstructorsUsed:true,
  sourceAndOffsiteS3CiphertextCompared:true,
  secondKmsEncryptedDataKeyUsedInRestore:true,
  signedImmutableDestinationEscrowVerified:true,
  sourceAwsNotContactedDuringOffsiteRestore:true,
  twoDistinctEd25519ReviewerKeysVerified:true,
  actualRealAwsAccountsUsed:false,actualHumanApprovalsVerified:false,
  actualCrossAccountReplicationObserved:false,
  actualOffsiteAwsKmsPolicyIndependentlyAudited:false,
  actualProductionRpoRtoProven:false,
  hostedSupabaseChanged:false,productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,reportName),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 destCmk.fill(0);replicaBlob.fill(0);sealed.blob.fill(0);
 console.log('R173_REAL_PG17_NATIVE_OFFSITE_ONLY_BACKUP_RESTORE=PASS');
 console.log('R173_SECOND_KMS_DEK_ESCROW_AND_SIGNED_IMMUTABLE_S3=PASS');
 console.log('R173_SOURCE_AWS_DOWN_RESTORED_RLS_AND_REPLAY_NONCE=PASS');
 console.log('R173_GENUINE_AWS_SDK_CLASSES_NO_LIVE_AWS_CALLS=PASS');
}
