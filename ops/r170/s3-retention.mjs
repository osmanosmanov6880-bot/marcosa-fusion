/**
 * R170 version-specific S3 Object Lock evidence and encrypted archive readback.
 * Uses real AWS SDK v3 GetObjectRetention + GetObjectAttributes along with
 * R168 version-pinned HEAD/GET SHA-256. Read-only: no PutObject or KMS Decrypt.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const VERSION=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R170 S3 witness: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
function equalHex(a,b){
 ok(H64.test(a||'')&&H64.test(b||''),'full SHA-256 required');
 return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
export function createR170S3RetentionWitness({
 client,commands,s3,accountId,bucket,kmsKeyArn,
 allowExternalCalls=false,clock=()=>Date.now(),minRemainingDays=6
}={}){
 ok(/^[0-9]{12}$/.test(accountId||'')&&
  typeof bucket==='string'&&/^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(bucket)&&
  typeof kmsKeyArn==='string'&&kmsKeyArn.startsWith('arn:aws:kms:')&&
  s3&&typeof s3.get==='function'&&typeof s3.inspect==='function'&&
  client&&typeof client.send==='function'&&commands&&
  ['GetObjectRetentionCommand','GetObjectAttributesCommand'].every(
   k=>typeof commands[k]==='function')&&
  typeof clock==='function'&&Number.isInteger(minRemainingDays)&&
  minRemainingDays>=1&&minRemainingDays<=30,
  'pinned S3 provider and read-only SDK v3 commands required');
 const base={Bucket:bucket,ExpectedBucketOwner:accountId};
 async function request(command){
  ok(allowExternalCalls===true,'network disabled without staging approval');
  try{return await client.send(command,{
   abortSignal:AbortSignal.timeout(8000)
  });}catch{fail('S3 read-only retention or object attributes unavailable');}
 }
 async function inspect({sha256,versionId,commit,bundleSha256,archiveId,
  contextSha256}={}){
  ok(allowExternalCalls===true,'network disabled without staging approval');
  ok(H64.test(sha256||'')&&VERSION.test(versionId||'')&&
   H40.test(commit||'')&&H64.test(bundleSha256||'')&&
   ID.test(archiveId||'')&&H64.test(contextSha256||''),
   'expected exact source-bound immutable object reference');
  const start=clock();
  ok(Number.isSafeInteger(start)&&start>0,'trusted time required');
  const desired=new Date(start+minRemainingDays*86400000);
  const key='marcosa/isolated/r168/'+sha256+'.r165enc';
  const head=await s3.inspect({
   sha256,versionId,minimumRetentionMs:desired.getTime()
  });
  const [ret,attr]=await Promise.all([
   request(new commands.GetObjectRetentionCommand({
    ...base,Key:key,VersionId:versionId
   })),
   request(new commands.GetObjectAttributesCommand({
    ...base,Key:key,VersionId:versionId,
    ObjectAttributes:['Checksum','ObjectSize']
   }))
  ]);
  const retained=ret?.Retention;
  const retainsUntil=new Date(retained?.RetainUntilDate).getTime();
  const headUntil=new Date(head.ObjectLockRetainUntilDate).getTime();
  ok(retained?.Mode==='COMPLIANCE'&&
   Number.isSafeInteger(retainsUntil)&&
   retainsUntil>=desired.getTime()&&retainsUntil===headUntil,
   'S3 COMPLIANCE retention differs between HEAD and GetObjectRetention');
  const expectedChecksum=Buffer.from(sha256,'hex').toString('base64');
  ok(attr?.VersionId===versionId&&
   attr?.ObjectSize===head.ContentLength&&
   attr?.Checksum?.ChecksumSHA256===expectedChecksum&&
   head.ChecksumSHA256===expectedChecksum&&
   attr?.DeleteMarker!==true,
   'S3 object attributes, size, checksum or version inconsistent');
  // Independent content read: do not accept metadata without actual SHA bytes.
  const fetched=await s3.get({
   sha256,versionId,commit,bundleSha256,archiveId,contextSha256
  });
  ok(fetched?.remoteObjectVersionVerified===true&&
   fetched?.complianceRetentionVerified===true&&
   fetched.versionId===versionId&&fetched.sha256===sha256&&
   Buffer.isBuffer(fetched.blob)&&fetched.blob.length===attr.ObjectSize&&
   Buffer.isBuffer(fetched.encryptedKey)&&
   fetched.encryptedKey.length>=64&&fetched.encryptedKey.length<=1000,
   'S3 full versioned ciphertext readback missing');
  const actual=createHash('sha256').update(fetched.blob).digest('hex');
  ok(equalHex(actual,sha256),'S3 encrypted archive content changed');
  return Object.freeze({
   verified:true,sha256,versionId,bucket,accountId,kmsKeyArn,
   bytes:attr.ObjectSize,retainUntilMs:retainsUntil,verifiedAtMs:start,
   expiresAtMs:start+60000,
   immutableVersionReadbackVerified:true,
   aesGcmNotDecrypted:true,
   independentOffsiteAccountVerified:false,
   productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  readOnly:true,networkEnabled:allowExternalCalls,
  productionAuthorized:false
 })});
}
export function verifyR170S3RetentionWitness(proof,{sha256,versionId,bucket,
 accountId,kmsKeyArn,clock=()=>Date.now()}={}){
 const now=clock();
 ok(proof&&proof.verified===true&&
  proof.sha256===sha256&&proof.versionId===versionId&&
  proof.bucket===bucket&&proof.accountId===accountId&&
  proof.kmsKeyArn===kmsKeyArn&&
  proof.immutableVersionReadbackVerified===true&&
  proof.aesGcmNotDecrypted===true&&
  proof.independentOffsiteAccountVerified===false&&
  proof.productionAuthorized===false&&
  Number.isSafeInteger(now)&&
  now>=proof.verifiedAtMs&&now<=proof.expiresAtMs&&
  proof.expiresAtMs-proof.verifiedAtMs<=60000&&
  proof.retainUntilMs>now,
  'missing, modified or stale independent S3 versioned receipt');
 return Object.freeze({verified:true,productionAuthorized:false});
}
