/**
 * R178 two-account full encrypted S3 version readback, no KMS Decrypt.
 * Exact source/offsite versions, independently configured bucket Object
 * Lock, public blocking, SSE-KMS and SHA256 of actual ciphertext bytes.
 * Network disabled by default. CI injects synthetic SDK responses.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 VER=/^[A-Za-z0-9_.-]{1,128}$/,
 KMS=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/[a-f0-9-]{36}$/;
const fail=m=>{throw Error('R178 replica audit: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const eq=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
function valid(x){
 const k=KMS.exec(x?.kmsKeyArn||'');
 return x&&typeof x.client?.send==='function'&&
  /^[0-9]{12}$/.test(x.accountId||'')&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(x.bucket||'')&&
  k&&k[1]===x.region&&k[2]===x.accountId;
}
export function createR178ReplicaAudit({source,offsite,commands,
 clock=()=>Date.now(),maxBytes=16*1024*1024,allowExternalCalls=false}={}){
 ok(valid(source)&&valid(offsite)&&
  source.accountId!==offsite.accountId&&source.region!==offsite.region&&
  source.bucket!==offsite.bucket&&source.client!==offsite.client&&
  commands&&[
   'HeadObjectCommand','GetObjectCommand','GetObjectRetentionCommand',
   'GetBucketVersioningCommand','GetObjectLockConfigurationCommand',
   'GetPublicAccessBlockCommand'
  ].every(x=>typeof commands[x]==='function')&&
  typeof clock==='function'&&Number.isSafeInteger(maxBytes)&&
  maxBytes>=512&&maxBytes<=268435456,
  'two isolated versioned S3 accounts, SDK read-only commands and bound required');
 async function request(target,name,args){
  ok(allowExternalCalls===true,'S3 network disabled by default');
  try{return await target.client.send(new commands[name+'Command'](args),{
   abortSignal:AbortSignal.timeout(12000)});
  }catch{fail('S3 pinned read-only API denied: '+name);}
 }
 async function streamHash(body,length){
  const h=createHash('sha256');let size=0;
  const push=chunk=>{
   ok(Buffer.isBuffer(chunk)||typeof chunk==='string'||
    chunk instanceof Uint8Array,'invalid streamed ciphertext chunk');
   const b=Buffer.from(chunk);size+=b.length;
   ok(size<=maxBytes&&size<=length,'ciphertext stream overflow');
   h.update(b);
  };
  if(Buffer.isBuffer(body))push(body);
  else if(body&&typeof body[Symbol.asyncIterator]==='function'){
   for await(const chunk of body)push(chunk);
  }else fail('full S3 ciphertext stream required (HEAD alone insufficient)');
  ok(size===length,'short ciphertext or changed ContentLength');
  return h.digest('hex');
 }
 async function inspectOne(target,key,versionId,expected){
  const base={Bucket:target.bucket,ExpectedBucketOwner:target.accountId};
  const [versions,lock,publicBlock,head,retention]=await Promise.all([
   request(target,'GetBucketVersioning',base),
   request(target,'GetObjectLockConfiguration',base),
   request(target,'GetPublicAccessBlock',base),
   request(target,'HeadObject',{...base,Key:key,VersionId:versionId,
    ChecksumMode:'ENABLED'}),
   request(target,'GetObjectRetention',{...base,Key:key,VersionId:versionId})
  ]);
  ok(versions?.Status==='Enabled'&&versions.MFADelete!=='Enabled'&&
   lock?.ObjectLockConfiguration?.ObjectLockEnabled==='Enabled'&&
   Object.values(publicBlock?.PublicAccessBlockConfiguration||{}).length===4&&
   ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']
    .every(x=>publicBlock.PublicAccessBlockConfiguration[x]===true),
   'S3 versioning, Object Lock or all-four public-access blocks missing');
  const expectedChecksum=Buffer.from(expected.sha256,'hex').toString('base64');
  const retainUntilMs=new Date(retention?.Retention?.RetainUntilDate).getTime();
  const headUntilMs=new Date(head?.ObjectLockRetainUntilDate).getTime();
  ok(head?.VersionId===versionId&&head.DeleteMarker!==true&&
   Number.isSafeInteger(head.ContentLength)&&
   head.ContentLength>=512&&head.ContentLength<=maxBytes&&
   head.ContentType==='application/vnd.marcosa.r178-encrypted-archive'&&
   head.ServerSideEncryption==='aws:kms'&&
   head.SSEKMSKeyId===target.kmsKeyArn&&
   head.ObjectLockMode==='COMPLIANCE'&&
   retention?.Retention?.Mode==='COMPLIANCE'&&
   Number.isSafeInteger(retainUntilMs)&&
   retainUntilMs>=expected.minRetainMs&&retainUntilMs===headUntilMs&&
   head.ChecksumSHA256===expectedChecksum&&
   head.Metadata?.['marcosa-commit']===expected.commit&&
   head.Metadata?.['marcosa-bundle-sha256']===expected.bundleSha256&&
   head.Metadata?.['marcosa-history-root-sha256']===expected.historyRootSha256,
   'S3 exact-version checksum, full encryption, retention or source metadata drift');
  const body=await request(target,'GetObject',{
   ...base,Key:key,VersionId:versionId,ChecksumMode:'ENABLED'});
  ok(body?.VersionId===versionId&&
   body.ContentLength===head.ContentLength&&
   body.ChecksumSHA256===expectedChecksum,
   'GET replaced or unchecked offsite S3 ciphertext');
  const actual=await streamHash(body.Body,head.ContentLength);
  ok(eq(actual,expected.sha256),
   'full ciphertext bytes do not match pinned SHA256');
  return{accountId:target.accountId,bucket:target.bucket,
   versionId,kmsKeyArn:target.kmsKeyArn,sha256:actual,
   bytes:head.ContentLength,retainUntilMs};
 }
 async function inspect({sha256,sourceVersionId,offsiteVersionId,
 commit,bundleSha256,historyRootSha256}={}){
  ok(allowExternalCalls===true,'read-only S3 inspection not opted in');
  ok([sha256,bundleSha256,historyRootSha256].every(x=>H64.test(x||''))&&
   H40.test(commit||'')&&VER.test(sourceVersionId||'')&&
   VER.test(offsiteVersionId||''),
   'pinned encrypted archive and two explicit S3 object versions required');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted S3 inspection timestamp');
  const key='marcosa/isolated/r178/archive/'+sha256+'.bin';
  const expected={sha256,commit,bundleSha256,historyRootSha256,
   minRetainMs:now+6*86400000};
  const src=await inspectOne(source,key,sourceVersionId,expected);
  const dst=await inspectOne(offsite,key,offsiteVersionId,expected);
  ok(src.bytes===dst.bytes&&src.sha256===dst.sha256&&
   src.accountId!==dst.accountId&&src.kmsKeyArn!==dst.kmsKeyArn,
   'cross-account full ciphertext parity not established');
  const observedAtMs=clock();
  ok(observedAtMs>=now&&observedAtMs-now<=60000,
   'S3 version evidence stale during full readback');
  return Object.freeze({
   verified:true,schemaVersion:1,commit,bundleSha256,historyRootSha256,
   archiveSha256:sha256,sourceAccountId:src.accountId,
   offsiteAccountId:dst.accountId,
   sourceVersionId,offsiteVersionId,sourceKmsKeyArn:src.kmsKeyArn,
   offsiteKmsKeyArn:dst.kmsKeyArn,
   sourceBucket:src.bucket,offsiteBucket:dst.bucket,
   encryptedBytes:src.bytes,observedAtMs,expiresAtMs:observedAtMs+60000,
   bothFullCiphertextSha256Verified:true,
   twoAccountsAndRegionsConfigured:true,
   independentProviderCredentialsProven:false,
   actualCrossAccountReplicaDeliveryProven:false,
   productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>({
  networkEnabled:allowExternalCalls,
  onlyCiphertextRead:true,productionAuthorized:false})});
}
