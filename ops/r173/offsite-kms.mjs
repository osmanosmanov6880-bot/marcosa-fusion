/**
 * R173 dual-KMS envelope: source data key is separately encrypted under
 * an independent destination-account KMS CMK BEFORE source deletion.
 * Replicating SSE-KMS objects alone does not re-wrap the client-side R165 DEK.
 * Caller must durably carry the wrapped offsite key in a signed escrow record.
 *
 * No automatic retries, credential discovery or actual AWS calls by default.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {r168KmsContext} from '../r168/aws-kms.mjs';
const KMS=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/[a-f0-9-]{36}$/;
const H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R173 dual KMS: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function createR173OffsiteKmsBridge({
 offsiteClient,commands,sourceKmsArn,offsiteKmsArn,
 clock=()=>Date.now(),allowExternalCalls=false
}={}){
 const s=KMS.exec(sourceKmsArn||''),d=KMS.exec(offsiteKmsArn||'');
 ok(s&&d&&s[2]!==d[2]&&s[1]!==d[1]&&
  sourceKmsArn!==offsiteKmsArn&&
  offsiteClient&&typeof offsiteClient.send==='function'&&
  commands&&['EncryptCommand','DecryptCommand'].every(
   k=>typeof commands[k]==='function')&&
  typeof clock==='function',
  'independent source/destination CMKs and official SDK v3 required');
 async function request(name,input){
  ok(allowExternalCalls===true,'offsite KMS network disabled');
  try{
   return await offsiteClient.send(new commands[name+'Command'](input),{
    abortSignal:AbortSignal.timeout(9000)
   });
  }catch{fail('offsite KMS rejected encrypted data key or context');}
 }
 async function wrap({plaintextKey,sourceEncryptedKey,
  commit,bundleSha256,archiveId}={}){
  ok(allowExternalCalls===true,'offsite KMS network disabled');
  ok(Buffer.isBuffer(plaintextKey)&&plaintextKey.length===32&&
   Buffer.isBuffer(sourceEncryptedKey)&&sourceEncryptedKey.length>=64&&
   sourceEncryptedKey.length<=1000,
   'only an existing 256-bit source DEK and bounded source envelope');
  const context=r168KmsContext({commit,bundleSha256,archiveId});
  const temp=Buffer.from(plaintextKey);
  let result;
  try{
   result=await request('Encrypt',{
    KeyId:offsiteKmsArn,Plaintext:temp,EncryptionContext:context
   });
  }finally{temp.fill(0);}
  const ciphertext=result?.CiphertextBlob;
  ok(result?.KeyId===offsiteKmsArn&&
   ciphertext instanceof Uint8Array&&
   ciphertext.byteLength>=64&&ciphertext.byteLength<=1000,
   'offsite KMS key or ciphertext was substituted');
  const encryptedKey=Buffer.from(ciphertext);
  const keyContextSha256=hash(Buffer.from(JSON.stringify(context)));
  const stamp=clock();
  ok(Number.isSafeInteger(stamp)&&stamp>0,'trusted timestamp required');
  return Object.freeze({
   encryptedKey,sourceEncryptedKeySha256:hash(sourceEncryptedKey),
   offsiteEncryptedKeySha256:hash(encryptedKey),
   keyContextSha256,sourceKmsArn,offsiteKmsArn,
   commit,bundleSha256,archiveId,createdAtMs:stamp,
   independentDestinationKeyWrapReturned:true,
   destinationKmsKeyPolicyIndependentlyAudited:false,
   productionAuthorized:false
  });
 }
 async function unwrap({encryptedKey,encryptedKeySha256,
  keyContextSha256,commit,bundleSha256,archiveId}={}){
  ok(allowExternalCalls===true,'offsite KMS network disabled');
  ok(Buffer.isBuffer(encryptedKey)&&encryptedKey.length>=64&&
   encryptedKey.length<=1000&&
   same(hash(encryptedKey),encryptedKeySha256),
   'no unsigned/changed offsite wrapped data key allowed');
  const context=r168KmsContext({commit,bundleSha256,archiveId});
  ok(same(hash(Buffer.from(JSON.stringify(context))),keyContextSha256),
   'offsite KMS authenticated encryption context changed');
  const output=await request('Decrypt',{
   KeyId:offsiteKmsArn,CiphertextBlob:Buffer.from(encryptedKey),
   EncryptionContext:context
  });
  ok(output?.KeyId===offsiteKmsArn&&
   output.Plaintext instanceof Uint8Array&&output.Plaintext.length===32,
   'offsite KMS returned wrong key or malformed plaintext');
  const key=Buffer.from(output.Plaintext);
  output.Plaintext.fill(0);
  return Object.freeze({plaintextKey:key,sourceKeyNotRequired:true,
   destKeyArn:offsiteKmsArn,productionAuthorized:false});
 }
 return Object.freeze({wrap,unwrap,sourceKmsArn,offsiteKmsArn,
  publicStatus:()=>Object.freeze({networkEnabled:allowExternalCalls,
   twoIndependentCmkRequired:true,productionAuthorized:false})});
}
