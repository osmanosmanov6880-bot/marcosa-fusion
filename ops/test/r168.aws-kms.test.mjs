import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {createR168AwsKmsAdapter,r168KmsContext} from '../r168/aws-kms.mjs';
const keyArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const args={commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),archiveId:'c'.repeat(32)};
class GenerateDataKeyCommand{constructor(input){this.input=input;}}
class DecryptCommand{constructor(input){this.input=input;}}
function fakeKms(){
 const master=randomBytes(32),calls=[],client={async send(command){
  calls.push(command.input);
  const c=command.input;
  if(command instanceof GenerateDataKeyCommand){
   const dataKey=randomBytes(32),iv=randomBytes(12);
   const cipher=createCipheriv('aes-256-gcm',master,iv);
   cipher.setAAD(Buffer.from(JSON.stringify(c.EncryptionContext)));
   const encrypted=Buffer.concat([cipher.update(dataKey),cipher.final()]);
   return {KeyId:keyArn,Plaintext:dataKey,
    CiphertextBlob:Buffer.concat([iv,encrypted,cipher.getAuthTag(),
     Buffer.alloc(48)])};
  }
  if(command instanceof DecryptCommand){
   const b=Buffer.from(c.CiphertextBlob),iv=b.subarray(0,12);
   const dec=createDecipheriv('aes-256-gcm',master,iv);
   dec.setAAD(Buffer.from(JSON.stringify(c.EncryptionContext)));
   dec.setAuthTag(b.subarray(44,60));
   return {KeyId:keyArn,Plaintext:Buffer.concat([dec.update(b.subarray(12,44)),dec.final()])};
  }
  throw Error('Unexpected AWS SDK command');
 }};
 return{client,calls};
}
const base=pool=>createR168AwsKmsAdapter({client:pool.client,
 commands:{GenerateDataKeyCommand,DecryptCommand},
 keyArn,region:'eu-west-1',accountId:'111122223333',
 allowExternalCalls:true});
test('R168 official KMS v3 command shapes, context-bound key and zeroized source buffer',async()=>{
 const fake=fakeKms(),adapter=base(fake);
 const issued=await adapter.issue(args);
 assert.equal(issued.plaintextKey.length,32);
 assert.equal(issued.encryptedKey.length,108);
 assert.equal(fake.calls[0].KeySpec,'AES_256');
 assert.deepEqual(fake.calls[0].EncryptionContext,r168KmsContext(args));
 const copied=Buffer.from(issued.plaintextKey);
 const reloaded=await adapter.unwrap({...args,encryptedKey:issued.encryptedKey});
 assert.deepEqual(reloaded.plaintextKey,copied);
 issued.plaintextKey.fill(0);reloaded.plaintextKey.fill(0);copied.fill(0);
 assert.equal(fake.calls[1].KeyId,keyArn);
 assert.equal(adapter.publicStatus().productionAuthorized,false);
});
test('R168 KMS refuses substituted archive, wrong key ARN, forbidden network and malformed SDK values',async()=>{
 const fake=fakeKms(),a=base(fake),issued=await a.issue(args);
 await assert.rejects(a.unwrap({...args,archiveId:'d'.repeat(32),
  encryptedKey:issued.encryptedKey}),/R168 KMS/);
 const off=createR168AwsKmsAdapter({client:fake.client,
  commands:{GenerateDataKeyCommand,DecryptCommand},keyArn,
  region:'eu-west-1',accountId:'111122223333'});
 await assert.rejects(off.issue(args),/network disabled/);
 assert.throws(()=>createR168AwsKmsAdapter({client:fake.client,
  commands:{GenerateDataKeyCommand,DecryptCommand},keyArn,
  region:'eu-north-1',accountId:'111122223333'}),/pinned concrete/);
 await assert.rejects(a.issue({...args,archiveId:'../../'}),/exact synthetic/);
 issued.plaintextKey.fill(0);
});
