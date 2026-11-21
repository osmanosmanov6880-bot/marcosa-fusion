import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {createR173OffsiteKmsBridge} from '../r173/offsite-kms.mjs';
const sourceKmsArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),archiveId='c'.repeat(32),
 dataKey=randomBytes(32),sourceEncryptedKey=randomBytes(96),clock=()=>1800000000000;
const commands=Object.fromEntries(['Encrypt','Decrypt'].map(x=>[
 x+'Command',class{constructor(input){this.name=x;this.input=input;}}
]));
function fixture({wrongArn=false,badCiphertext=false,failed=false,changedPlaintext=false}={}){
 const cmk=randomBytes(32),calls=[];
 const client={send:async command=>{
  calls.push(command);
  if(failed)throw Error('KMS unavailable');
  const input=command.input;
  if(command.name==='Encrypt'){
   const iv=randomBytes(12);
   const enc=createCipheriv('aes-256-gcm',cmk,iv);
   enc.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
   const out=Buffer.concat([iv,enc.update(input.Plaintext),enc.final(),
    enc.getAuthTag(),randomBytes(48)]);
   return{KeyId:wrongArn?sourceKmsArn:offsiteKmsArn,
    CiphertextBlob:badCiphertext?Buffer.from('bad'):out};
  }
  const blob=Buffer.from(input.CiphertextBlob),dec=createDecipheriv(
   'aes-256-gcm',cmk,blob.subarray(0,12));
  dec.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
  dec.setAuthTag(blob.subarray(44,60));
  let plain=Buffer.concat([dec.update(blob.subarray(12,44)),dec.final()]);
  if(changedPlaintext)plain=randomBytes(32);
  return{KeyId:wrongArn?sourceKmsArn:offsiteKmsArn,Plaintext:plain};
 }};
 const bridge=createR173OffsiteKmsBridge({
  offsiteClient:client,commands,sourceKmsArn,offsiteKmsArn,
  allowExternalCalls:true,clock
 });
 return{bridge,calls,dispose:()=>cmk.fill(0)};
}
test('R173 independent offsite KMS encrypt and decrypt same DEK without source account key',async()=>{
 const f=fixture();
 try{
  const source=Buffer.from(dataKey);
  const w=await f.bridge.wrap({plaintextKey:source,sourceEncryptedKey,
   commit,bundleSha256,archiveId});
  assert.equal(w.offsiteKmsArn,offsiteKmsArn);
  assert.equal(w.offsiteEncryptedKeySha256.length,64);
  assert.equal(w.independentDestinationKeyWrapReturned,true);
  assert.equal(w.productionAuthorized,false);
  assert.equal(source.equals(dataKey),true);
  assert.equal(f.calls[0].input.KeyId,offsiteKmsArn);
  const p=await f.bridge.unwrap({
   encryptedKey:w.encryptedKey,
   encryptedKeySha256:w.offsiteEncryptedKeySha256,
   keyContextSha256:w.keyContextSha256,
   commit,bundleSha256,archiveId
  });
  assert.equal(p.plaintextKey.equals(dataKey),true);
  assert.equal(p.sourceKeyNotRequired,true);
  p.plaintextKey.fill(0);source.fill(0);
 }finally{f.dispose();}
});
test('R173 rejects tampered envelope and wrong encryption context, forbids silent KMS fallbacks',async()=>{
 const f=fixture();
 try{
  const w=await f.bridge.wrap({
   plaintextKey:Buffer.from(dataKey),sourceEncryptedKey,
   commit,bundleSha256,archiveId
  });
  await assert.rejects(f.bridge.unwrap({
   encryptedKey:w.encryptedKey,
   encryptedKeySha256:w.offsiteEncryptedKeySha256,
   keyContextSha256:w.keyContextSha256,
   commit,bundleSha256,archiveId:'d'.repeat(32)
  }),/R173 dual KMS/);
  await assert.rejects(f.bridge.unwrap({
   encryptedKey:w.encryptedKey,
   encryptedKeySha256:'d'.repeat(64),
   keyContextSha256:w.keyContextSha256,
   commit,bundleSha256,archiveId
  }),/R173 dual KMS/);
 }finally{f.dispose();}
 for(const opts of [{wrongArn:true},{badCiphertext:true},{failed:true}]){
  const x=fixture(opts);
  try{await assert.rejects(x.bridge.wrap({
   plaintextKey:Buffer.from(dataKey),sourceEncryptedKey,
   commit,bundleSha256,archiveId
  }),/R173 dual KMS/);}finally{x.dispose();}
 }
});
test('R173 refuses same-account KMS and network without opt-in',async()=>{
 assert.throws(()=>createR173OffsiteKmsBridge({
  offsiteClient:{send:async()=>{}},commands,sourceKmsArn,
  offsiteKmsArn:sourceKmsArn
 }),/R173 dual KMS/);
 const off=createR173OffsiteKmsBridge({
  offsiteClient:{send:async()=>{throw Error('no network');}},commands,
  sourceKmsArn,offsiteKmsArn,clock
 });
 await assert.rejects(off.wrap({
  plaintextKey:Buffer.from(dataKey),sourceEncryptedKey,
  commit,bundleSha256,archiveId
 }),/network disabled/);
});
