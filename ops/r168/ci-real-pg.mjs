/**
 * R168 disposable real PostgreSQL 17 acceptance.
 * AWS command shapes and crypto are tested against an in-process fake SDK.
 * This intentionally does NOT call a live account or claim an AWS IAM audit.
 */
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {readR167FixtureInventory} from '../r167/pg-witness.mjs';
import {createR168SimulatedAws} from './mock-aws.mjs';
import {createR168AwsKmsAdapter} from './aws-kms.mjs';
import {createR168AwsS3Adapter} from './aws-s3.mjs';
import {createR168AwsPreflight} from './aws-preflight.mjs';
import {createR168BackupPipeline} from './backup-pipeline.mjs';
const env=process.env,repo='osmanosmanov6880-bot/marcosa-fusion';
const check=(x,m)=>{if(!x)throw Error('R168 real PG17 CI: '+m);};
check(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===repo&&
 env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 /^[a-f0-9]{12,64}$/.test(env.R168_PG_CONTAINER||'')&&
 typeof env.RUNNER_TEMP==='string',
 'dedicated GitHub Actions runner and disposable PostgreSQL17 required');
const commit=env.GITHUB_SHA,bundle=await buildR163Bundle({
 root:process.cwd(),commit
});
function execute(binary,args,{input}={}){
 const r=spawnSync(binary,args,{input,encoding:null,timeout:55000,
  maxBuffer:40*1024*1024});
 check(r.status===0&&!r.error,'test PostgreSQL command failed: '+binary);
 return r.stdout;
}
function sql(db,query){
 return execute('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-d',db,'-c',query])
  .toString('utf8').trim();
}
const sha256=b=>Buffer.from(b).toString('hex').slice(0,16);
const original=execute('docker',['exec','-u','postgres',env.R168_PG_CONTAINER,
 'pg_dump','-U','postgres','-d','postgres','--format=custom']);
check(original.length>=512&&original.length<25*1024*1024&&
 original.subarray(0,5).toString('utf8')==='PGDMP',
 'native PostgreSQL17 custom archive required');
let aws;
try{
 const sourceInventory=await readR167FixtureInventory({
  sqlRead:async q=>sql('postgres',q)
 });
 aws=createR168SimulatedAws();
 const common={region:aws.region,accountId:aws.accountId,
  keyArn:aws.keyArn,allowExternalCalls:true};
 const kms=createR168AwsKmsAdapter({client:aws.kmsClient,
  commands:aws.commands,...common});
 const s3=createR168AwsS3Adapter({
  client:aws.s3Client,commands:aws.commands,
  region:aws.region,accountId:aws.accountId,bucket:aws.bucket,
  kmsKeyArn:aws.keyArn,allowExternalCalls:true,retainDays:7});
 const preflight=createR168AwsPreflight({
  sts:aws.stsClient,kms:aws.kmsClient,s3:aws.s3Client,
  commands:aws.commands,region:aws.region,accountId:aws.accountId,
  bucket:aws.bucket,kmsKeyArn:aws.keyArn,allowExternalCalls:true});
 const pipe=createR168BackupPipeline({kms,s3,preflight});
 const archiveId=randomBytes(16).toString('hex');
 const saved=await pipe.backup({
  plaintext:original,commit,bundleSha256:bundle.sha256,
  archiveId,sourceInventory
 });
 check(saved.reference.productionAuthorized===false&&
  saved.remoteReceiptVerified===true,'AWS-shaped immutable object missing');
 let pgRestored=false;
 const result=await pipe.rehearseRecovery({
  reference:saved.reference,sourceInventory,
  pinnedInventorySha256:saved.reference.inventorySha256,
  restoreIntoDisposableDatabase:async({database,plaintext,productionAuthorized})=>{
   check(database==='marcosa_r168_restored'&&productionAuthorized===false&&
    plaintext.subarray(0,5).toString('utf8')==='PGDMP',
    'restore target not isolated');
   sql('postgres','CREATE DATABASE marcosa_r168_restored TEMPLATE template0;');
   execute('docker',['exec','-u','postgres','-i',env.R168_PG_CONTAINER,
    'pg_restore','-U','postgres','--no-owner','--exit-on-error',
    '-d',database],{input:plaintext});
   pgRestored=true;
   return {success:true,database};
  },
  readRestoredInventory:async({database})=>
   readR167FixtureInventory({sqlRead:async q=>sql(database,q)})
 });
 check(pgRestored&&result.verified&&result.independentSqlWitnessVerified&&
  result.productionAuthorized===false,
  'fresh PostgreSQL17 data, RLS, sessions and quarantine did not match');
 let governanceDenied=false,publicDenied=false,corruptDenied=false,decryptDenied=false;
 aws.alter({governance:true});
 try{await preflight.inspect();}catch{governanceDenied=true;}
 aws.alter({governance:false,publicAccess:true});
 try{await preflight.inspect();}catch{publicDenied=true;}
 aws.alter({publicAccess:false,corruptBody:true});
 try{await pipe.rehearseRecovery({
  reference:saved.reference,sourceInventory,
  pinnedInventorySha256:saved.reference.inventorySha256,
  restoreIntoDisposableDatabase:async()=>{throw Error('forbidden');},
  readRestoredInventory:async()=>sourceInventory
 });}catch{corruptDenied=true;}
 aws.alter({corruptBody:false,failDecrypt:true});
 try{await pipe.rehearseRecovery({
  reference:saved.reference,sourceInventory,
  pinnedInventorySha256:saved.reference.inventorySha256,
  restoreIntoDisposableDatabase:async()=>{throw Error('forbidden');},
  readRestoredInventory:async()=>sourceInventory
 });}catch{decryptDenied=true;}
 check([governanceDenied,publicDenied,corruptDenied,decryptDenied].every(Boolean),
  'mock IAM/ObjectLock/S3/KMS negative recovery did not fail closed');
 const calls=aws.metrics();
 check(calls.objects===1&&
  ['GenerateDataKeyCommand','DecryptCommand','PutObjectCommand','GetObjectCommand',
   'HeadObjectCommand','GetCallerIdentityCommand','DescribeKeyCommand',
   'GetBucketVersioningCommand','GetObjectLockConfigurationCommand',
   'GetPublicAccessBlockCommand','GetBucketLocationCommand']
   .every(name=>calls.commandTypes.includes(name)),
  'missing required AWS v3 command contract');
 const report={
  schemaVersion:1,commit,bundleSha256:bundle.sha256,
  encryptedSha256:saved.reference.encryptedSha256,
  sourceInventorySha256:saved.reference.inventorySha256,
  objectVersion:saved.reference.versionId,
  nativePostgres17Restored:true,sourceRlsEqualsTargetRls:true,
  signedEncryptedArchiveMetadataVerified:true,
  kmsContextAndDecryptVerified:true,
  complianceLockAndPublicBlockVerifiedAgainstMock:true,
  vendorSdkV3InputShapesExercised:true,
  negativeAccessDowngradeAndCryptoChecksPass:true,
  realAwsAccountVerified:false,realExternalS3Connected:false,
  realKmsConnected:false,independentKmsSecurityAudit:false,
  productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,'r168-safe-provider-evidence.json'),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R168_REAL_PG17_KMS_S3_ADAPTERS_RESTORED=PASS');
 console.log('R168_PROVIDER_STS_KMS_VERSIONING_COMPLIANCE_GUARD=PASS');
 console.log('R168_SOURCE_RESTORED_RLS_QUARANTINE_SESSIONS_MATCH=PASS');
 console.log('R168_BAD_OBJECTLOCK_PUBLIC_ACCESS_KMS_CIPHERTEXT_DENIED=PASS');
 console.log('R168_REAL_AWS_ACCOUNT_KMS_AND_PRODUCTION=NO_GO');
}finally{
 original.fill(0);
 if(aws)aws.dispose();
}
