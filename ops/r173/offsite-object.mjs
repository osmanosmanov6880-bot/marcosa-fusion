/**
 * R173 cross-account *data* verification, not replication config inspection.
 * S3 replication preserves object user metadata, so kms-arn metadata refers
 * to the source client-side envelope while SSEKMSKeyId differs offsite.
 * Source and destination version IDs are independent. Never trust ETag as SHA.
 * This module cannot read cloud resources unless explicitly opted in.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const VERSION=/^[A-Za-z0-9_.-]{1,128}$/,ACCOUNT=/^[0-9]{12}$/;
const KMS=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/[a-f0-9-]{36}$/;
const MAGIC=Buffer.from('MARCOSA-R165-BACKUP-V1\n');
const LIMIT=25*1024*1024+2048;
const fail=m=>{throw Error('R173 offsite S3: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const sameHex=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const expectedKeys=['archive-id','bundle-sha','commit','context-sha256',
 'encrypted-key','kms-arn','sha256'].sort().join(',');
async function bodyBytes(input,n){
 if(Buffer.isBuffer(input)){
  ok(input.length===n,'truncated buffer');
  return Buffer.from(input);
 }
 ok(input&&typeof input[Symbol.asyncIterator]==='function',
  'bounded S3 response stream required');
 const chunks=[];let bytes=0;
 for await(const part of input){
  const chunk=Buffer.from(part);bytes+=chunk.length;
  ok(bytes<=n&&bytes<=LIMIT,'oversized S3 response');
  chunks.push(chunk);
 }
 ok(bytes===n,'truncated streaming response');
 return Buffer.concat(chunks);
}
export function createR173OffsiteObject({
 sourceClient,offsiteClient,commands,
 sourceAccountId,offsiteAccountId,sourceRegion,offsiteRegion,
 sourceBucket,offsiteBucket,sourceKmsArn,offsiteKmsArn,
 clock=()=>Date.now(),allowExternalCalls=false
}={}){
 const sm=KMS.exec(sourceKmsArn||''),dm=KMS.exec(offsiteKmsArn||'');
 ok(ACCOUNT.test(sourceAccountId||'')&&ACCOUNT.test(offsiteAccountId||'')&&
  sourceAccountId!==offsiteAccountId&&sourceRegion!==offsiteRegion&&
  sourceBucket!==offsiteBucket&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(sourceBucket||'')&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(offsiteBucket||'')&&
  sm&&dm&&sm[1]===sourceRegion&&sm[2]===sourceAccountId&&
  dm[1]===offsiteRegion&&dm[2]===offsiteAccountId&&
  sourceClient&&typeof sourceClient.send==='function'&&
  offsiteClient&&typeof offsiteClient.send==='function'&&
  commands&&['HeadObjectCommand','GetObjectCommand'].every(
   k=>typeof commands[k]==='function')&&typeof clock==='function',
  'two separate AWS accounts/regions and exact SDK clients required');
 async function send(client,ctor,args){
  ok(allowExternalCalls===true,'external offsite read disabled');
  try{return await client.send(new commands[ctor+'Command'](args),{
   abortSignal:AbortSignal.timeout(12000)
  });}catch{fail('source or destination S3 API denied');}
 }
 function location({sha256,sourceVersionId,offsiteVersionId,commit,
  bundleSha256,archiveId,contextSha256}={}){
  ok(H64.test(sha256||'')&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&H64.test(contextSha256||'')&&
   ID.test(archiveId||'')&&VERSION.test(sourceVersionId||'')&&
   VERSION.test(offsiteVersionId||''),
   'exact source, two independently versioned objects and context required');
  return 'marcosa/isolated/r168/'+sha256+'.r165enc';
 }
 function validHead(head,{sha256,versionId,kmsArn,replicationStatus,
  commit,bundleSha256,archiveId,contextSha256,minRetentionMs}){
  const meta=head?.Metadata;
  ok(head?.VersionId===versionId&&
   head.ContentType==='application/vnd.marcosa.r165enc'&&
   Number.isSafeInteger(head.ContentLength)&&head.ContentLength>700&&
   head.ContentLength<=LIMIT&&
   head.ServerSideEncryption==='aws:kms'&&
   head.SSEKMSKeyId===kmsArn&&
   head.ReplicationStatus===replicationStatus&&
   head.ObjectLockMode==='COMPLIANCE'&&
   new Date(head.ObjectLockRetainUntilDate).getTime()>=minRetentionMs&&
   meta&&Object.getPrototypeOf(meta)===Object.prototype&&
   Object.keys(meta).sort().join(',')===expectedKeys&&
   meta.sha256===sha256&&meta.commit===commit&&
   meta['bundle-sha']===bundleSha256&&
   meta['archive-id']===archiveId&&
   meta['context-sha256']===contextSha256&&
   meta['kms-arn']===sourceKmsArn&&
   typeof meta['encrypted-key']==='string'&&
   /^[A-Za-z0-9+/]{80,1340}={0,2}$/.test(meta['encrypted-key']),
   'S3 version, replication, object lock, KMS or envelope metadata differs');
  if(head.ChecksumSHA256!==undefined)ok(
   head.ChecksumSHA256===Buffer.from(sha256,'hex').toString('base64'),
   'single PutObject SHA256 checksum differs');
  return head;
 }
 async function read({sha256,sourceVersionId,offsiteVersionId,
  commit,bundleSha256,archiveId,contextSha256,minRemainingDays=6,
  compareSource=false}={}){
  ok(allowExternalCalls===true,'offsite network disabled');
  const key=location({sha256,sourceVersionId,offsiteVersionId,
   commit,bundleSha256,archiveId,contextSha256});
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0&&
   Number.isInteger(minRemainingDays)&&minRemainingDays>=1&&
   minRemainingDays<=30,'trusted clock/retention bound required');
  const minRetentionMs=now+minRemainingDays*86400000;
  const base={Key:key,ChecksumMode:'ENABLED'};
  const destHead=validHead(await send(offsiteClient,'HeadObject',{
   ...base,Bucket:offsiteBucket,ExpectedBucketOwner:offsiteAccountId,
   VersionId:offsiteVersionId
  }),{sha256,versionId:offsiteVersionId,kmsArn:offsiteKmsArn,
   replicationStatus:'REPLICA',commit,bundleSha256,archiveId,
   contextSha256,minRetentionMs});
  const response=await send(offsiteClient,'GetObject',{
   ...base,Bucket:offsiteBucket,ExpectedBucketOwner:offsiteAccountId,
   VersionId:offsiteVersionId
  });
  ok(response?.VersionId===offsiteVersionId&&
   response.ContentLength===destHead.ContentLength&&
   response.ContentType===destHead.ContentType,
   'offsite GET version/size/mime changed since HEAD');
  const blob=await bodyBytes(response.Body,destHead.ContentLength);
  ok(sameHex(hash(blob),sha256)&&
   blob.subarray(0,MAGIC.length).equals(MAGIC),
   'offsite ciphertext was corrupted or replaced');
  if(compareSource){
   const h=validHead(await send(sourceClient,'HeadObject',{
    ...base,Bucket:sourceBucket,ExpectedBucketOwner:sourceAccountId,
    VersionId:sourceVersionId
   }),{sha256,versionId:sourceVersionId,kmsArn:sourceKmsArn,
    replicationStatus:'COMPLETED',commit,bundleSha256,archiveId,
    contextSha256,minRetentionMs});
   const v=await send(sourceClient,'GetObject',{
    ...base,Bucket:sourceBucket,ExpectedBucketOwner:sourceAccountId,
    VersionId:sourceVersionId
   });
   ok(v?.VersionId===sourceVersionId&&
    v.ContentLength===h.ContentLength&&v.ContentLength===blob.length,
    'source GET identity differs from offsite readback');
   const source=await bodyBytes(v.Body,v.ContentLength);
   try{ok(timingSafeEqual(source,blob)&&sameHex(hash(source),sha256),
    'offsite content differs from the source');}
   finally{source.fill(0);}
  }
  return Object.freeze({blob,encryptedSourceKey:Buffer.from(
   destHead.Metadata['encrypted-key'],'base64'),
   sourceVersionId,offsiteVersionId,sha256,archiveId,commit,
   bundleSha256,contextSha256,
   crossAccountCiphertextReadbackVerified:true,
   sourceComparedThisRun:compareSource,
   destinationSseKmsKeyArn:offsiteKmsArn,
   offsiteClientSideEnvelopeDecryptableWithoutSourceKms:false,
   actualAwsProviderConnected:false,productionAuthorized:false});
 }
 return Object.freeze({read,publicStatus:()=>Object.freeze({
  readOnly:true,sourceAccountId,offsiteAccountId,
  networkEnabled:allowExternalCalls,productionAuthorized:false
 })});
}
