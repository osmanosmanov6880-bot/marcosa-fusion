/**
 * R168 AWS KMS v3 adapter. The caller injects official @aws-sdk/client-kms
 * command classes and KMSClient; no credentials, endpoint or live account
 * is provisioned by this module. Every network operation is opt-in.
 * EncryptionContext contains only non-personal fixed identifiers.
 */
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/,NONCE=/^[a-f0-9]{32}$/;
const ARN=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const fail=m=>{throw Error('R168 KMS: '+m);};
const guard=(v,m)=>{if(!v)fail(m);};
const u8=b=>b instanceof Uint8Array&&b.byteLength>0;
export function r168KmsContext({commit,bundleSha256,archiveId}={}){
 guard(SHA40.test(commit||'')&&SHA64.test(bundleSha256||'')&&NONCE.test(archiveId||''),
  'exact synthetic source and archive identity required');
 return Object.freeze({
  'marcosa-project':'marcosa-fusion',
  'marcosa-scope':'isolated-staging-only',
  'marcosa-version':'r168',
  'source-commit':commit,'source-bundle':bundleSha256,'archive-id':archiveId
 });
}
export function createR168AwsKmsAdapter({client,commands,keyArn,region,accountId,
 allowExternalCalls=false,clock=()=>Date.now()}={}){
 const match=typeof keyArn==='string'?ARN.exec(keyArn):null;
 guard(match&&match[1]===region&&match[2]===accountId&&
  typeof region==='string'&&typeof accountId==='string',
  'pinned concrete KMS key ARN, region and account required');
 guard(client&&typeof client.send==='function'&&commands&&
  typeof commands.GenerateDataKeyCommand==='function'&&
  typeof commands.DecryptCommand==='function'&&
  typeof clock==='function',
  'injected official AWS SDK v3 command constructors and client required');
 async function issue({commit,bundleSha256,archiveId}={}){
  guard(allowExternalCalls===true,'network disabled without explicit operator opt-in');
  const encryptionContext=r168KmsContext({commit,bundleSha256,archiveId});
  let value;
  try{
   value=await client.send(new commands.GenerateDataKeyCommand({
    KeyId:keyArn,KeySpec:'AES_256',EncryptionContext:encryptionContext
   }),{abortSignal:AbortSignal.timeout(7000)});
  }catch{fail('GenerateDataKey failed closed');}
  guard(value?.KeyId===keyArn&&u8(value.Plaintext)&&value.Plaintext.byteLength===32&&
   u8(value.CiphertextBlob)&&value.CiphertextBlob.byteLength>=64&&
   value.CiphertextBlob.byteLength<=1000,
   'wrong KMS key identity, data key length or encrypted key size');
  const plaintextKey=Buffer.from(value.Plaintext);
  const encryptedKey=Buffer.from(value.CiphertextBlob);
  // The caller MUST zeroize plaintextKey in finally. SDK response buffer
  // is zeroed as early as possible to reduce retained key material.
  value.Plaintext.fill(0);
  return Object.freeze({plaintextKey,encryptedKey,keyArn,
   encryptionContext,issuedAtMs:clock(),
   identityBoundByKms:true,liveKmsCallAttempted:true,
   productionAuthorized:false});
 }
 async function unwrap({encryptedKey,commit,bundleSha256,archiveId}={}){
  guard(allowExternalCalls===true,'network disabled without explicit operator opt-in');
  guard(u8(encryptedKey)&&encryptedKey.byteLength>=64&&
   encryptedKey.byteLength<=1000,'bounded encrypted data key required');
  const encryptionContext=r168KmsContext({commit,bundleSha256,archiveId});
  let value;
  try{
   value=await client.send(new commands.DecryptCommand({
    KeyId:keyArn,CiphertextBlob:Buffer.from(encryptedKey),
    EncryptionContext:encryptionContext
   }),{abortSignal:AbortSignal.timeout(7000)});
  }catch{fail('Decrypt or authenticated context rejected');}
  guard(value?.KeyId===keyArn&&u8(value.Plaintext)&&
   value.Plaintext.byteLength===32,
   'KMS returned mismatched key or invalid 256-bit data key');
  const plaintextKey=Buffer.from(value.Plaintext);
  value.Plaintext.fill(0);
  return Object.freeze({plaintextKey,identityBoundByKms:true,
   productionAuthorized:false});
 }
 return Object.freeze({issue,unwrap,keyArn,region,accountId,
  publicStatus:()=>Object.freeze({keyArn,region,accountId,
   networkOptIn:allowExternalCalls===true,providerCredentialVerified:false,
   kmsPolicyIndependentlyReviewed:false,productionAuthorized:false})});
}
