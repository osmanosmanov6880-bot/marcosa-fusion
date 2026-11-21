/**
 * R175 immutable, source-independent anchor store using the offsite account.
 * Every anchor is content-addressed, version specific and signed by the two
 * previously pinned Ed25519 keys. No GET of an unversioned "latest" object.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {verifyR175DualAnchor} from './dual-anchor.mjs';
const H64=/^[a-f0-9]{64}$/,VER=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R175 offsite anchor store: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const eq=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function createR175OffsiteAnchorStore({client,commands,bucket,
 accountId,kmsKeyArn,pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
 clock=()=>Date.now(),allowExternalCalls=false}={}){
 ok(client&&typeof client.send==='function'&&commands&&
  ['PutObjectCommand','HeadObjectCommand','GetObjectCommand'].every(
   name=>typeof commands[name]==='function')&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(bucket||'')&&
  /^[0-9]{12}$/.test(accountId||'')&&
  kmsKeyArn?.startsWith('arn:aws:kms:')&&
  kmsKeyArn.includes(':'+accountId+':key/')&&
  H64.test(pinnedOperatorSpkiSha256||'')&&
  H64.test(pinnedReviewerSpkiSha256||'')&&
  pinnedOperatorSpkiSha256!==pinnedReviewerSpkiSha256,
  'pinned independent AWS destination and two signer fingerprints required');
 const prefix='marcosa/isolated/r175/anchors/';
 const path=sha=>prefix+sha+'.ed25519.json';
 const args={Bucket:bucket,ExpectedBucketOwner:accountId};
 async function send(type,input){
  ok(allowExternalCalls===true,'remote S3 disabled by default');
  try{
   return await client.send(new commands[type+'Command'](input),{
    abortSignal:AbortSignal.timeout(8500)
   });
  }catch{fail('offsite anchor S3 denied');}
 }
 function verifyReceipt(receipt,expected){
  return verifyR175DualAnchor({
   receipt,pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
   ...expected,clock
  });
 }
 async function head(sha256,versionId,contentLength,minRetainMs){
  const h=await send('HeadObject',{...args,Key:path(sha256),VersionId:versionId,
   ChecksumMode:'ENABLED'});
  ok(h?.VersionId===versionId&&h.ContentLength===contentLength&&
   h.ContentType==='application/vnd.marcosa.r175-anchor+json'&&
   h.ServerSideEncryption==='aws:kms'&&h.SSEKMSKeyId===kmsKeyArn&&
   h.ObjectLockMode==='COMPLIANCE'&&
   new Date(h.ObjectLockRetainUntilDate).getTime()>=minRetainMs&&
   h.ChecksumSHA256===Buffer.from(sha256,'hex').toString('base64'),
   'anchor version, SHA-256, COMPLIANCE or KMS encryption weakened');
 }
 async function save({receipt,expected}={}){
  ok(allowExternalCalls===true,'remote S3 disabled by default');
  verifyReceipt(receipt,expected);
  const bytes=Buffer.from(JSON.stringify(receipt));
  ok(bytes.length>500&&bytes.length<=10000,'bounded signed anchor only');
  const sha256=hash(bytes);
  const date=new Date(clock()+7*86400000);
  const put=await send('PutObject',{...args,Key:path(sha256),
   Body:bytes,ContentLength:bytes.length,
   ContentType:'application/vnd.marcosa.r175-anchor+json',
   IfNoneMatch:'*',
   ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64'),
   ServerSideEncryption:'aws:kms',SSEKMSKeyId:kmsKeyArn,
   ObjectLockMode:'COMPLIANCE',ObjectLockRetainUntilDate:date});
  ok(VER.test(put?.VersionId||''),'offsite anchor must be versioned');
  await head(sha256,put.VersionId,bytes.length,date.getTime());
  return Object.freeze({sha256,versionId:put.VersionId,
   key:path(sha256),accountId,bucket,immutableVersionChecked:true,
   productionAuthorized:false});
 }
 async function read({sha256,versionId,expected}={}){
  ok(H64.test(sha256||'')&&VER.test(versionId||''),
   'explicit SHA-256 and pinned S3 version required');
  const h=await send('HeadObject',{...args,Key:path(sha256),
   VersionId:versionId,ChecksumMode:'ENABLED'});
  ok(Number.isSafeInteger(h?.ContentLength)&&h.ContentLength>500&&
   h.ContentLength<=10000,'bounded anchor HEAD missing');
  await head(sha256,versionId,h.ContentLength,clock()+86400000);
  const get=await send('GetObject',{...args,Key:path(sha256),
   VersionId:versionId,ChecksumMode:'ENABLED'});
  ok(get?.VersionId===versionId&&get.ContentLength===h.ContentLength,
   'anchor GET changed version or size');
  let bytes;
  if(Buffer.isBuffer(get.Body))bytes=Buffer.from(get.Body);
  else if(get.Body&&typeof get.Body[Symbol.asyncIterator]==='function'){
   const chunks=[];let n=0;
   for await(const item of get.Body){
    const chunk=Buffer.from(item);n+=chunk.length;
    ok(n<=h.ContentLength&&n<=10000,'anchor stream overflow');
    chunks.push(chunk);
   }
   bytes=Buffer.concat(chunks);
  }else fail('anchor GET body unavailable');
  ok(bytes.length===h.ContentLength&&eq(hash(bytes),sha256),
   'offsite anchor byte hash mismatch');
  let receipt;
  try{receipt=JSON.parse(bytes.toString('utf8'));}
  catch{fail('anchor JSON invalid');}
  const verified=verifyReceipt(receipt,expected);
  return Object.freeze({receipt,sha256,versionId,verified:verified.verified,
   productionAuthorized:false});
 }
 return Object.freeze({save,read,publicStatus:()=>({
  readOnlyByDefault:!allowExternalCalls,
  accountId,productionAuthorized:false
 })});
}
