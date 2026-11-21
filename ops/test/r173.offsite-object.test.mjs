import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createR173OffsiteObject} from '../r173/offsite-object.mjs';
const sourceAccountId='111122223333',offsiteAccountId='444455556666',
 sourceRegion='eu-west-1',offsiteRegion='eu-central-1',
 sourceBucket='marcosa-ci-locked',offsiteBucket='marcosa-offsite-locked',
 sourceKmsArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 archiveId='c'.repeat(32),contextSha256='d'.repeat(64);
const blob=Buffer.concat([Buffer.from('MARCOSA-R165-BACKUP-V1\n'),Buffer.alloc(1000,7)]);
const sha256=createHash('sha256').update(blob).digest('hex');
const sourceVersionId='src-v11',offsiteVersionId='replica-v71',clock=()=>1800000000000;
const meta={sha256,commit,'bundle-sha':bundleSha256,
 'archive-id':archiveId,'context-sha256':contextSha256,
 'kms-arn':sourceKmsArn,'encrypted-key':Buffer.alloc(100,8).toString('base64')};
const inputs={sourceAccountId,offsiteAccountId,sourceRegion,offsiteRegion,
 sourceBucket,offsiteBucket,sourceKmsArn,offsiteKmsArn,clock};
const req={sha256,sourceVersionId,offsiteVersionId,commit,bundleSha256,
 archiveId,contextSha256};
const commands=Object.fromEntries(['HeadObject','GetObject'].map(n=>[
 n+'Command',class{constructor(input){this.input=input;this.name=n;}}
]));
function fixture({status='REPLICA',badOwner=false,corrupt=false,
 governance=false,wrongKms=false,badMeta=false,
 sourceOffline=false,truncated=false}={}){
 const calls=[];
 function client(source){
  return{send:async command=>{
   calls.push({source,command});
   if(source&&sourceOffline)throw Error('source unavailable');
   const key=command.input.ExpectedBucketOwner;
   if(badOwner&&!source&&key===offsiteAccountId)
    throw Error('forged account');
   const v=source?sourceVersionId:offsiteVersionId;
   if(command.name==='HeadObject')return{
    VersionId:v,ContentType:'application/vnd.marcosa.r165enc',
    ContentLength:blob.length,ServerSideEncryption:'aws:kms',
    SSEKMSKeyId:wrongKms&&!source?sourceKmsArn:
     source?sourceKmsArn:offsiteKmsArn,
    ReplicationStatus:source?'COMPLETED':status,
    ObjectLockMode:governance?'GOVERNANCE':'COMPLIANCE',
    ObjectLockRetainUntilDate:new Date(clock()+9*86400000),
    ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64'),
    Metadata:badMeta?{...meta,commit:'wrong'}:meta
   };
   return{VersionId:v,ContentType:'application/vnd.marcosa.r165enc',
    ContentLength:blob.length,Body:Readable.from([
     corrupt?Buffer.alloc(blob.length,9):
     truncated?blob.subarray(0,blob.length-2):blob
    ])};
  }};
 }
 return{adapter:createR173OffsiteObject({
  ...inputs,sourceClient:client(true),offsiteClient:client(false),
  commands,allowExternalCalls:true
 }),calls};
}
test('R173 reads independent source/offsite S3 versions with exact ciphertext and compliant SSE-KMS',async()=>{
 const f=fixture(),proof=await f.adapter.read({...req,compareSource:true});
 assert.equal(proof.crossAccountCiphertextReadbackVerified,true);
 assert.equal(proof.sourceComparedThisRun,true);
 assert.notEqual(proof.sourceVersionId,proof.offsiteVersionId);
 assert.equal(proof.destinationSseKmsKeyArn,offsiteKmsArn);
 assert.equal(proof.offsiteClientSideEnvelopeDecryptableWithoutSourceKms,false);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(f.calls.length,4);
 assert.equal(f.calls[0].command.input.ExpectedBucketOwner,offsiteAccountId);
 assert.equal(proof.blob.equals(blob),true);
});
test('R173 offsite-only availability does not require source account to read replica',async()=>{
 const f=fixture({sourceOffline:true});
 const v=await f.adapter.read(req);
 assert.equal(v.crossAccountCiphertextReadbackVerified,true);
 assert.equal(f.calls.length,2);
 await assert.rejects(f.adapter.read({...req,compareSource:true}),
  /R173 offsite S3/);
});
test('R173 fails on stale replica, different KMS, governance, tamper, bad metadata and truncation',async()=>{
 for(const x of [
  {status:'PENDING'},{status:'FAILED'},{governance:true},
  {wrongKms:true},{badMeta:true},{corrupt:true},
  {truncated:true},{badOwner:true}
 ])await assert.rejects(fixture(x).adapter.read(req),/R173 offsite S3/);
});
test('R173 refuses same AWS account or unapproved network',async()=>{
 assert.throws(()=>createR173OffsiteObject({
  ...inputs,offsiteAccountId:sourceAccountId
 }),/R173 offsite S3/);
 const off=createR173OffsiteObject({
  ...inputs,sourceClient:{send:async()=>{throw Error('network');}},
  offsiteClient:{send:async()=>{throw Error('network');}},commands
 });
 await assert.rejects(off.read(req),/network disabled/);
});
