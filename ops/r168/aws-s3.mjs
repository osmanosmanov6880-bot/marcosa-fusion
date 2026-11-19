/**
 * R168 AWS S3 SDK v3 immutable archive adapter.
 * Requires a versioned S3 bucket with Object Lock in COMPLIANCE mode. Uses
 * client-side R165 AES-GCM ciphertext AND pinned SSE-KMS, content SHA-256,
 * conditional PutObject and version-specific Head/Get readback.
 * No SDK credentials, buckets or real network are created automatically.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const HEX40=/^[a-f0-9]{40}$/,HEX64=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const BUCKET=/^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)(?!-)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ARN=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/([a-f0-9-]{36})$/;
const VERSION=/^[A-Za-z0-9_.-]{1,128}$/;
const MAGIC=Buffer.from('MARCOSA-R165-BACKUP-V1\n');
const MAX=25*1024*1024+2048;
const fail=m=>{throw Error('R168 S3: '+m);};
const check=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const checksum=x=>Buffer.from(sha(x),'hex').toString('base64');
const lengthBound=x=>x>700&&x<=MAX;
const metadataKeys=['archive-id','bundle-sha','commit','context-sha256',
 'encrypted-key','kms-arn','sha256'].sort().join(',');
function validateMeta(meta,expected){
 check(meta&&Object.getPrototypeOf(meta)===Object.prototype&&
  Object.keys(meta).sort().join(',')===metadataKeys,
  'unexpected object metadata');
 for(const key of Object.keys(expected))
  check(meta[key]===expected[key],'object metadata differs from signed receipt');
 check(HEX64.test(meta['context-sha256']||'')&&
  typeof meta['encrypted-key']==='string'&&
  /^[A-Za-z0-9+/]{80,1340}={0,2}$/.test(meta['encrypted-key']),
  'bounded opaque KMS encrypted data key required');
}
async function collectBody(body,size){
 if(Buffer.isBuffer(body)){
  check(body.length===size,'truncated S3 buffer');
  return Buffer.from(body);
 }
 check(body&&typeof body[Symbol.asyncIterator]==='function',
  'bounded streaming S3 body required');
 const out=[];let bytes=0;
 for await(const chunk of body){
  const v=Buffer.from(chunk);
  bytes+=v.length;
  check(bytes<=MAX&&bytes<=size,'oversized S3 body');
  out.push(v);
 }
 check(bytes===size,'S3 body length differs');
 return Buffer.concat(out);
}
export function createR168AwsS3Adapter({client,commands,bucket,region,accountId,
 kmsKeyArn,allowExternalCalls=false,clock=()=>Date.now(),
 retainDays=7}={}){
 const m=typeof kmsKeyArn==='string'?ARN.exec(kmsKeyArn):null;
 check(m&&m[1]===region&&m[2]===accountId&&
  BUCKET.test(bucket||'')&&Number.isInteger(retainDays)&&
  retainDays>=7&&retainDays<=30,
  'pinned ordinary bucket, key ARN, account and compliance retention required');
 check(client&&typeof client.send==='function'&&commands&&
  ['PutObjectCommand','HeadObjectCommand','GetObjectCommand'].every(
   k=>typeof commands[k]==='function')&&typeof clock==='function',
  'official injected S3 v3 command constructors required');
 const base={Bucket:bucket,ExpectedBucketOwner:accountId};
 const keyFor=hash=>'marcosa/isolated/r168/'+hash+'.r165enc';
 const send=async(command)=>{
  check(allowExternalCalls===true,'S3 network disabled without operator opt-in');
  try{return await client.send(command,{abortSignal:AbortSignal.timeout(8000)});}
  catch{fail('provider operation failed closed without implicit app retry');}
 };
 async function inspect({sha256,versionId,minimumRetentionMs=clock()}={}){
  check(HEX64.test(sha256||'')&&VERSION.test(versionId||'')&&
   Number.isSafeInteger(minimumRetentionMs),
   'fixed object digest, version and retention required');
  const head=await send(new commands.HeadObjectCommand({
   ...base,Key:keyFor(sha256),VersionId:versionId,ChecksumMode:'ENABLED'
  }));
  check(head?.VersionId===versionId&&
   head.ContentType==='application/vnd.marcosa.r165enc'&&
   head.ServerSideEncryption==='aws:kms'&&head.SSEKMSKeyId===kmsKeyArn&&
   head.ObjectLockMode==='COMPLIANCE'&&
   Number.isFinite(new Date(head.ObjectLockRetainUntilDate).getTime())&&
   new Date(head.ObjectLockRetainUntilDate).getTime()>=minimumRetentionMs&&
   lengthBound(head.ContentLength)&&
   head.ChecksumSHA256===Buffer.from(sha256,'hex').toString('base64'),
   'S3 version, immutability, SSE-KMS or complete checksum not confirmed');
  validateMeta(head.Metadata,{sha256,'kms-arn':kmsKeyArn});
  return head;
 }
 async function put({blob,commit,bundleSha256,archiveId,encryptedKey,
  contextSha256}={}){
  check(allowExternalCalls===true,'S3 network disabled without operator opt-in');
  check(Buffer.isBuffer(blob)&&lengthBound(blob.length)&&
   blob.subarray(0,MAGIC.length).equals(MAGIC)&&
   HEX40.test(commit||'')&&HEX64.test(bundleSha256||'')&&
   ID.test(archiveId||'')&&HEX64.test(contextSha256||'')&&
   encryptedKey instanceof Uint8Array&&
   encryptedKey.byteLength>=64&&encryptedKey.byteLength<=1000,
   'strict encrypted archive, source and KMS data-key reference required');
  const digest=sha(blob),encoded=Buffer.from(encryptedKey).toString('base64');
  const Metadata={
   sha256:digest,commit,'bundle-sha':bundleSha256,'archive-id':archiveId,
   'encrypted-key':encoded,'context-sha256':contextSha256,'kms-arn':kmsKeyArn
  };
  check(Object.values(Metadata).join('').length<1900,
   'S3 user metadata 2KB budget exceeded');
  const retainUntil=new Date(clock()+retainDays*86400000);
  let output;
  try{output=await send(new commands.PutObjectCommand({
   ...base,Key:keyFor(digest),Body:blob,
   ContentLength:blob.length,ContentType:'application/vnd.marcosa.r165enc',
   IfNoneMatch:'*',ChecksumSHA256:checksum(blob),Metadata,
   ServerSideEncryption:'aws:kms',SSEKMSKeyId:kmsKeyArn,
   ObjectLockMode:'COMPLIANCE',ObjectLockRetainUntilDate:retainUntil
  }));}catch{fail('conditional write not proven; no automatic retry');}
  check(VERSION.test(output?.VersionId||''),'unversioned or failed S3 object write');
  const head=await inspect({sha256:digest,versionId:output.VersionId,
   minimumRetentionMs:retainUntil.getTime()});
  validateMeta(head.Metadata,Metadata);
  return Object.freeze({sha256:digest,versionId:output.VersionId,
   bytes:blob.length,archiveId,commit,bundleSha256,contextSha256,
   complianceObjectLockVerified:true,providerPolicyIndependentlyReviewed:false,
   productionAuthorized:false});
 }
 async function get({sha256,versionId,commit,bundleSha256,archiveId,
  contextSha256}={}){
  check(HEX40.test(commit||'')&&HEX64.test(bundleSha256||'')&&
   ID.test(archiveId||'')&&HEX64.test(contextSha256||''),
   'source-bound versioned read required');
  const h=await inspect({sha256,versionId});
  validateMeta(h.Metadata,{sha256,commit,'bundle-sha':bundleSha256,
   'archive-id':archiveId,'context-sha256':contextSha256,'kms-arn':kmsKeyArn});
  const value=await send(new commands.GetObjectCommand({
   ...base,Key:keyFor(sha256),VersionId:versionId,ChecksumMode:'ENABLED'
  }));
  check(value?.VersionId===versionId&&
   value.ContentLength===h.ContentLength&&
   value.ContentType===h.ContentType&&
   value.ChecksumSHA256===h.ChecksumSHA256,
   'retrieved S3 object version, length or checksum mismatch');
  const blob=await collectBody(value.Body,h.ContentLength);
  const actual=Buffer.from(sha(blob),'hex'),expected=Buffer.from(sha256,'hex');
  check(timingSafeEqual(actual,expected)&&
   blob.subarray(0,MAGIC.length).equals(MAGIC),
   'S3 content-addressed AES-GCM ciphertext changed');
  return Object.freeze({blob,encryptedKey:Buffer.from(h.Metadata['encrypted-key'],'base64'),
   sha256,versionId,archiveId,commit,bundleSha256,
   remoteObjectVersionVerified:true,complianceRetentionVerified:true,
   productionAuthorized:false});
 }
 return Object.freeze({put,get,inspect,bucket,region,accountId,kmsKeyArn,
  publicStatus:()=>Object.freeze({bucket,region,accountId,
   networkOptIn:allowExternalCalls,objectLockPreflightVerified:false,
   productionAuthorized:false})});
}
