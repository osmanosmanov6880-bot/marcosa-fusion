/**
 * R173 signed, pinned Ed25519 offsite escrow: independently store a second
 * KMS-encrypted AES data key in the destination S3 account under COMPLIANCE
 * Object Lock and versioning. The escrow contains no plaintext DEK.
 * Signed receipt alone does not prove human approver identity or AWS policies.
 */
import {createHash,createPublicKey,createPrivateKey,
 sign,verify as verifySignature,timingSafeEqual} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const KMS=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/[a-f0-9-]{36}$/;
const H64=/^[a-f0-9]{64}$/,H40=/^[a-f0-9]{40}$/,H32=/^[a-f0-9]{32}$/;
const VER=/^[A-Za-z0-9_.-]{1,128}$/;
const metaKeys=['schemaVersion','repository','scope','commit','bundleSha256',
 'archiveId','archiveSha256','sourceVersionId','offsiteVersionId',
 'inventorySha256','sourceAccountId','offsiteAccountId',
 'sourceKmsArn','offsiteKmsArn','sourceEncryptedKeySha256',
 'offsiteEncryptedKeySha256','keyContextSha256','offsiteEncryptedKeyBase64',
 'issuedAtMs','expiresAtMs','productionAuthorized'].sort().join(',');
const fail=m=>{throw Error('R173 escrow: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const pubSha=pem=>{
 const k=createPublicKey(pem);
 ok(k.asymmetricKeyType==='ed25519','pinned Ed25519 public key required');
 return hash(k.export({format:'der',type:'spki'}));
};
const equal=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
function validate(m,clock){
 const a=KMS.exec(m?.sourceKmsArn||''),b=KMS.exec(m?.offsiteKmsArn||'');
 const now=clock();
 ok(m&&Object.getPrototypeOf(m)===Object.prototype&&
  Object.keys(m).sort().join(',')===metaKeys&&
  m.schemaVersion===1&&m.repository===REPO&&
  m.scope==='cross-account-disposable-recovery-only'&&
  m.productionAuthorized===false&&H40.test(m.commit||'')&&
  [m.bundleSha256,m.archiveSha256,m.inventorySha256,
   m.sourceEncryptedKeySha256,m.offsiteEncryptedKeySha256,
   m.keyContextSha256].every(x=>H64.test(x||''))&&
  H32.test(m.archiveId||'')&&
  VER.test(m.sourceVersionId||'')&&VER.test(m.offsiteVersionId||'')&&
  a&&b&&a[2]!==b[2]&&a[1]!==b[1]&&
  m.sourceAccountId===a[2]&&m.offsiteAccountId===b[2]&&
  typeof m.offsiteEncryptedKeyBase64==='string'&&
  /^[A-Za-z0-9+/]{80,1340}={0,2}$/.test(m.offsiteEncryptedKeyBase64)&&
  equal(hash(Buffer.from(m.offsiteEncryptedKeyBase64,'base64')),
   m.offsiteEncryptedKeySha256)&&
  Number.isSafeInteger(m.issuedAtMs)&&Number.isSafeInteger(m.expiresAtMs)&&
  m.issuedAtMs<=now+15000&&now<=m.expiresAtMs&&
  m.expiresAtMs-m.issuedAtMs>=86400000&&
  m.expiresAtMs-m.issuedAtMs<=30*86400000,
  'exact source/destination/expiry, signed escrow and key ciphertext required');
}
export function issueR173Escrow({data,privateKey,
 clock=()=>Date.now(),ttlDays=15}={}){
 ok(Number.isInteger(ttlDays)&&ttlDays>=7&&ttlDays<=30,
  'escrow signed TTL 7-30 days required');
 const issuedAtMs=clock();
 const manifest={
  schemaVersion:1,repository:REPO,scope:'cross-account-disposable-recovery-only',
  commit:data?.commit,bundleSha256:data?.bundleSha256,
  archiveId:data?.archiveId,archiveSha256:data?.archiveSha256,
  sourceVersionId:data?.sourceVersionId,
  offsiteVersionId:data?.offsiteVersionId,
  inventorySha256:data?.inventorySha256,
  sourceAccountId:data?.sourceAccountId,offsiteAccountId:data?.offsiteAccountId,
  sourceKmsArn:data?.sourceKmsArn,offsiteKmsArn:data?.offsiteKmsArn,
  sourceEncryptedKeySha256:data?.sourceEncryptedKeySha256,
  offsiteEncryptedKeySha256:data?.offsiteEncryptedKeySha256,
  keyContextSha256:data?.keyContextSha256,
  offsiteEncryptedKeyBase64:data?.offsiteEncryptedKeyBase64,
  issuedAtMs,expiresAtMs:issuedAtMs+ttlDays*86400000,
  productionAuthorized:false
 };
 validate(manifest,clock);
 const signer=privateKey?.type==='private'?privateKey:createPrivateKey(privateKey);
 ok(signer.asymmetricKeyType==='ed25519','Ed25519 escrow private signer required');
 const publicKeyPem=createPublicKey(signer).export({format:'pem',type:'spki'});
 const signature=sign(null,Buffer.from(JSON.stringify(manifest)),
  signer).toString('base64url');
 return Object.freeze({manifest:Object.freeze(manifest),
  signature,publicKeyPem,signerSpkiSha256:pubSha(publicKeyPem),
  realHumanApprovalVerified:false,productionAuthorized:false});
}
export function verifyR173Escrow({receipt,pinnedSignerSpkiSha256,
 expectedCommit,expectedBundleSha256,expectedArchiveSha256,
 expectedOffsiteAccountId,clock=()=>Date.now()}={}){
 ok(receipt&&Object.getPrototypeOf(receipt)===Object.prototype&&
  Object.keys(receipt).sort().join(',')===
  'manifest,productionAuthorized,publicKeyPem,realHumanApprovalVerified,signature,signerSpkiSha256'&&
  receipt.productionAuthorized===false&&
  receipt.realHumanApprovalVerified===false,
  'exact signed escrow receipt structure required');
 const m=receipt.manifest;
 validate(m,clock);
 ok(m.commit===expectedCommit&&m.bundleSha256===expectedBundleSha256&&
  m.archiveSha256===expectedArchiveSha256&&
  m.offsiteAccountId===expectedOffsiteAccountId&&
  equal(pubSha(receipt.publicKeyPem),pinnedSignerSpkiSha256)&&
  equal(pubSha(receipt.publicKeyPem),receipt.signerSpkiSha256)&&
  typeof receipt.signature==='string'&&
  /^[A-Za-z0-9_-]{86}$/.test(receipt.signature)&&
  verifySignature(null,Buffer.from(JSON.stringify(m)),
   createPublicKey(receipt.publicKeyPem),
   Buffer.from(receipt.signature,'base64url')),
  'pinned Ed25519 signature or source-digest mismatched');
 return Object.freeze({verified:true,manifest:m,
  encryptedKey:Buffer.from(m.offsiteEncryptedKeyBase64,'base64'),
  signerPinned:true,productionAuthorized:false,
  humanIdentityVerified:false});
}
export function createR173OffsiteEscrowStore({
 client,commands,bucket,accountId,kmsKeyArn,
 pinnedSignerSpkiSha256,clock=()=>Date.now(),
 allowExternalCalls=false
}={}){
 const km=KMS.exec(kmsKeyArn||'');
 ok(km&&km[2]===accountId&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(bucket||'')&&
  client&&typeof client.send==='function'&&commands&&
  ['PutObjectCommand','HeadObjectCommand','GetObjectCommand'].every(
   k=>typeof commands[k]==='function')&&H64.test(pinnedSignerSpkiSha256||''),
  'exact offsite account CMK, pinned signer and SDK required');
 const base={Bucket:bucket,ExpectedBucketOwner:accountId};
 const keyFor=sha=>'marcosa/isolated/r173/escrow/'+sha+'.signed.json';
 async function send(type,input){
  ok(allowExternalCalls===true,'offsite escrow network disabled');
  try{
   return await client.send(new commands[type+'Command'](input),{
    abortSignal:AbortSignal.timeout(9000)
   });
  }catch{fail('offsite S3 immutable escrow request denied');}
 }
 async function save({receipt}={}){
  ok(allowExternalCalls===true,'offsite escrow network disabled');
  const proof=verifyR173Escrow({
   receipt,pinnedSignerSpkiSha256,
   expectedCommit:receipt?.manifest?.commit,
   expectedBundleSha256:receipt?.manifest?.bundleSha256,
   expectedArchiveSha256:receipt?.manifest?.archiveSha256,
   expectedOffsiteAccountId:accountId,clock
  });
  ok(proof.manifest.offsiteKmsArn===kmsKeyArn,
   'wrong destination KMS envelope');
  const bytes=Buffer.from(JSON.stringify(receipt));
  ok(bytes.length>=500&&bytes.length<=8000,'bounded encrypted escrow JSON only');
  const sha256=hash(bytes),key=keyFor(sha256);
  const retainUntil=new Date(clock()+7*86400000);
  const output=await send('PutObject',{
   ...base,Key:key,Body:bytes,ContentLength:bytes.length,
   ContentType:'application/vnd.marcosa.r173-escrow+json',
   IfNoneMatch:'*',ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64'),
   ServerSideEncryption:'aws:kms',SSEKMSKeyId:kmsKeyArn,
   ObjectLockMode:'COMPLIANCE',ObjectLockRetainUntilDate:retainUntil
  });
  ok(VER.test(output?.VersionId||''),'offsite escrow not versioned');
  await assertHead({sha256,versionId:output.VersionId,
   length:bytes.length,minRetentionMs:retainUntil.getTime()});
  return Object.freeze({
   sha256,versionId:output.VersionId,key,bucket,accountId,
   verifiedS3EscrowStorage:true,productionAuthorized:false
  });
 }
 async function assertHead({sha256,versionId,length,minRetentionMs}){
  ok(H64.test(sha256||'')&&VER.test(versionId||''),
   'versioned escrow SHA required');
  const head=await send('HeadObject',{
   ...base,Key:keyFor(sha256),VersionId:versionId,
   ChecksumMode:'ENABLED'
  });
  ok(head?.VersionId===versionId&&
   head.ContentLength===length&&
   head.ContentType==='application/vnd.marcosa.r173-escrow+json'&&
   head.ServerSideEncryption==='aws:kms'&&
   head.SSEKMSKeyId===kmsKeyArn&&head.ObjectLockMode==='COMPLIANCE'&&
   new Date(head.ObjectLockRetainUntilDate).getTime()>=minRetentionMs&&
   head.ChecksumSHA256===Buffer.from(sha256,'hex').toString('base64'),
   'escrow immutable retention, version, KMS, bytes or checksum mismatch');
 }
 async function read({sha256,versionId,commit,bundleSha256,archiveSha256}={}){
  ok(allowExternalCalls===true,'offsite escrow network disabled');
  ok(H64.test(sha256||'')&&VER.test(versionId||'')&&
   H40.test(commit||'')&&H64.test(bundleSha256||'')&&
   H64.test(archiveSha256||''),'escrow pinned identity required');
  const now=clock();
  const head=await send('HeadObject',{
   ...base,Key:keyFor(sha256),VersionId:versionId,
   ChecksumMode:'ENABLED'
  });
  ok(Number.isSafeInteger(head?.ContentLength)&&
   head.ContentLength>=500&&head.ContentLength<=8000,
   'escrow head length unavailable');
  await assertHead({sha256,versionId,length:head.ContentLength,
   minRetentionMs:now+86400000});
  const output=await send('GetObject',{
   ...base,Key:keyFor(sha256),VersionId:versionId,
   ChecksumMode:'ENABLED'
  });
  ok(output?.VersionId===versionId&&
   output.ContentLength===head.ContentLength,
   'escrow get version mismatch');
  let bytes;
  if(Buffer.isBuffer(output.Body))bytes=Buffer.from(output.Body);
  else if(output.Body&&typeof output.Body[Symbol.asyncIterator]==='function'){
   const pieces=[];let n=0;
   for await(const chunk of output.Body){
    const v=Buffer.from(chunk);n+=v.length;
    ok(n<=head.ContentLength&&n<=8000,'escrow response overflow');
    pieces.push(v);
   }
   bytes=Buffer.concat(pieces);
  }else fail('streamed escrow body missing');
  ok(bytes.length===head.ContentLength&&
   equal(hash(bytes),sha256),'offsite escrow ciphertext receipt changed');
  let receipt;
  try{receipt=JSON.parse(bytes.toString('utf8'));}
  catch{fail('offsite signed escrow JSON unreadable');}
  const proven=verifyR173Escrow({receipt,pinnedSignerSpkiSha256,
   expectedCommit:commit,expectedBundleSha256:bundleSha256,
   expectedArchiveSha256:archiveSha256,
   expectedOffsiteAccountId:accountId,clock
  });
  ok(proven.manifest.offsiteKmsArn===kmsKeyArn,
   'offsite KMS identity did not match signed receipt');
  return Object.freeze({receipt,verified:proven.verified,
   sha256,versionId,productionAuthorized:false});
 }
 return Object.freeze({save,read,publicStatus:()=>Object.freeze({
  sourceAccountNotRequired:true,networkEnabled:allowExternalCalls,
  productionAuthorized:false
 })});
}
