import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR170S3RetentionWitness,verifyR170S3RetentionWitness}
 from '../r170/s3-retention.mjs';
const now=1800000000000,clock=()=>now;
const bucket='marcosa-ci-locked',accountId='111122223333',
 kmsKeyArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 archiveId='c'.repeat(32),contextSha256='d'.repeat(64),
 versionId='version-r170-1';
const blob=sealR165Backup({plaintext:Buffer.concat([
 Buffer.from('PGDMP'),randomBytes(1300)]),key:randomBytes(32),
 commit,bundleSha256,createdAtMs:now}).blob;
const sha256=createHash('sha256').update(blob).digest('hex');
class GetObjectRetentionCommand{constructor(input){this.input=input;this.name='retention';}}
class GetObjectAttributesCommand{constructor(input){this.input=input;this.name='attributes';}}
function f({governance=false,wrongSize=false,wrongVersion=false,
 changedBlob=false,expired=false,missingChecksum=false}={}){
 const seen=[],when=new Date(now+(expired?1:8)*86400000);
 const client={send:async command=>{
  seen.push(command.input);
  if(command.name==='retention')return{
   Retention:{Mode:governance?'GOVERNANCE':'COMPLIANCE',RetainUntilDate:when}};
  return{VersionId:wrongVersion?'wrong':versionId,
   ObjectSize:blob.length+(wrongSize?1:0),
   Checksum:missingChecksum?{}:{ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}};
 }};
 const s3={
  inspect:async()=>({ContentLength:blob.length,ObjectLockRetainUntilDate:when,
   ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}),
  get:async()=>({remoteObjectVersionVerified:true,complianceRetentionVerified:true,
   versionId,sha256,blob:changedBlob?Buffer.alloc(blob.length):Buffer.from(blob),
   encryptedKey:randomBytes(120)})
 };
 const inspector=createR170S3RetentionWitness({
  client,commands:{GetObjectRetentionCommand,GetObjectAttributesCommand},
  s3,accountId,bucket,kmsKeyArn,allowExternalCalls:true,clock});
 const request={sha256,versionId,commit,bundleSha256,archiveId,contextSha256};
 return{inspector,request,seen};
}
test('R170 actual SDK GetObjectRetention + GetObjectAttributes validate same version and full encrypted SHA',async()=>{
 const x=f(),proof=await x.inspector.inspect(x.request);
 assert.equal(proof.verified,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(x.seen.length,2);
 assert.equal(x.seen[0].Key,'marcosa/isolated/r168/'+sha256+'.r165enc');
 assert.equal(x.seen[1].ObjectAttributes.join(','),'Checksum,ObjectSize');
 assert.equal(verifyR170S3RetentionWitness(proof,{sha256,versionId,bucket,
  accountId,kmsKeyArn,clock}).verified,true);
});
test('R170 rejects governance lock, expired retention, malformed checksum/version and tampered bytes',async()=>{
 for(const opt of [
  {governance:true},{wrongSize:true},{wrongVersion:true},
  {changedBlob:true},{expired:true},{missingChecksum:true}
 ])await assert.rejects(f(opt).inspector.inspect(f().request),/R170 S3 witness/);
 const proof=await f().inspector.inspect(f().request);
 assert.throws(()=>verifyR170S3RetentionWitness(proof,{sha256,versionId,bucket,
  accountId,kmsKeyArn,clock:()=>now+70000}),/R170 S3 witness/);
});
test('R170 S3 external reads are disabled by default',async()=>{
 const x=f();
 const off=createR170S3RetentionWitness({
  client:{send:async()=>{throw Error('must not call');}},
  commands:{GetObjectRetentionCommand,GetObjectAttributesCommand},
  s3:{get:async()=>null,inspect:async()=>null},
  accountId,bucket,kmsKeyArn,clock});
 await assert.rejects(off.inspect(x.request),/network disabled/);
});
