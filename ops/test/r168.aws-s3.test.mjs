import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR168AwsS3Adapter} from '../r168/aws-s3.mjs';
const arn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),archiveId='c'.repeat(32),contextSha256='d'.repeat(64);
class PutObjectCommand{constructor(input){this.input=input;}}
class HeadObjectCommand{constructor(input){this.input=input;}}
class GetObjectCommand{constructor(input){this.input=input;}}
const commands={PutObjectCommand,HeadObjectCommand,GetObjectCommand};
function fixture(){
 const blob=sealR165Backup({plaintext:Buffer.concat([Buffer.from('PGDMP'),randomBytes(1100)]),
  key:randomBytes(32),commit,bundleSha256}).blob;
 let object,checks=[],objectLock='COMPLIANCE';
 const client={async send(c){
  checks.push(c.input);
  if(c instanceof PutObjectCommand){
   if(object)throw Error('412');
   object={...c.input,VersionId:'version-r168-1'};return {VersionId:object.VersionId};
  }
  if(!object)throw Error('404');
  if(c instanceof HeadObjectCommand){
   return {VersionId:object.VersionId,ContentType:object.ContentType,
    ServerSideEncryption:object.ServerSideEncryption,
    SSEKMSKeyId:object.SSEKMSKeyId,ObjectLockMode:objectLock,
    ObjectLockRetainUntilDate:object.ObjectLockRetainUntilDate,
    ContentLength:object.ContentLength,
    ChecksumSHA256:object.ChecksumSHA256,Metadata:object.Metadata};
  }
  if(c instanceof GetObjectCommand)return{
   VersionId:object.VersionId,ContentLength:object.ContentLength,
   ContentType:object.ContentType,ChecksumSHA256:object.ChecksumSHA256,
   Body:Buffer.from(object.Body)};
  throw Error('unsupported');
 }};
 const adapter=createR168AwsS3Adapter({client,commands,bucket:'marcosa-ci-locked',
  accountId:'111122223333',region:'eu-west-1',kmsKeyArn:arn,
  allowExternalCalls:true,clock:()=>1800000000000});
 const input={blob,commit,bundleSha256,archiveId,contextSha256,
  encryptedKey:randomBytes(144)};
 return{adapter,input,checks,setLock:x=>{objectLock=x;},flip:()=>{object.Body[20]^=1;}};
}
test('R168 real SDK v3 S3 input: conditional put, COMPLIANCE retention, SSE KMS, checksums and versioned readback',async()=>{
 const f=fixture();
 const receipt=await f.adapter.put(f.input);
 assert.equal(receipt.complianceObjectLockVerified,true);
 const actual=await f.adapter.get({...receipt});
 assert.ok(actual.blob.equals(f.input.blob));
 assert.equal(actual.encryptedKey.length,144);
 assert.equal(f.checks[0].IfNoneMatch,'*');
 assert.equal(f.checks[0].ObjectLockMode,'COMPLIANCE');
 assert.equal(f.checks[0].ServerSideEncryption,'aws:kms');
 assert.equal(f.checks[0].ExpectedBucketOwner,'111122223333');
 assert.equal(actual.productionAuthorized,false);
 await assert.rejects(f.adapter.put(f.input),/R168 S3/);
});
test('R168 S3 never trusts governance lock, substituted metadata or tampered versions',async()=>{
 const f=fixture();
 const receipt=await f.adapter.put(f.input);
 f.setLock('GOVERNANCE');
 await assert.rejects(f.adapter.get(receipt),/immutability/);
 f.setLock('COMPLIANCE');
 f.flip();
 await assert.rejects(f.adapter.get(receipt),/ciphertext changed/);
 await assert.rejects(f.adapter.get({...receipt,archiveId:'e'.repeat(32)}),/metadata differs/);
});
test('R168 storage rejects invalid bucket, account, network not opted in',async()=>{
 const f=fixture(),shared={client:{send:async()=>{throw Error('unexpected');}},
  commands,bucket:'marcosa-ci-locked',accountId:'111122223333',region:'eu-west-1',
  kmsKeyArn:arn};
 assert.throws(()=>createR168AwsS3Adapter({...shared,bucket:'192.168.1.7'}),/pinned/);
 assert.throws(()=>createR168AwsS3Adapter({...shared,kmsKeyArn:'alias/example'}),/pinned/);
 const off=createR168AwsS3Adapter(shared);
 await assert.rejects(off.put(f.input),/network disabled/);
});
