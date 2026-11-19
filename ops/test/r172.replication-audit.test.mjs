import test from 'node:test';
import assert from 'node:assert/strict';
import {createR172ReplicationAudit,verifyR172ReplicationAudit}
 from '../r172/replication-audit.mjs';
const now=1800000000000,clock=()=>now;
const scope={
 sourceAccountId:'111122223333',sourceRegion:'eu-west-1',
 sourceBucket:'marcosa-ci-locked',
 sourceKmsArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 offsiteAccountId:'444455556666',offsiteRegion:'eu-central-1',
 offsiteBucket:'marcosa-offsite-ci-locked',
 offsiteKmsArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'
};
const commands=Object.fromEntries(['GetBucketReplication',
 'GetKeyRotationStatus','DescribeKey'].map(x=>[x+'Command',
 class{constructor(input){this.name=x;this.input=input;}}]));
function fixture({wrongAccount=false,deletedMarker=false,
 badRegion=false,rotationDisabled=false,roleChanged=false,
 replicationMissing=false,keyDisabled=false,networkDown=false}={}){
 const sent=[];
 const response=()=>({ReplicationConfiguration:{
  Role:'arn:aws:iam::'+scope.sourceAccountId+
   ':role/'+(roleChanged?'production-admin':'marcosa-staging-cross-account-replication'),
  Rules:[{
   ID:'marcosa-r172-offsite-immutable',Priority:1,Status:'Enabled',
   Filter:{Prefix:'marcosa/isolated/r168/'},
   DeleteMarkerReplication:{Status:deletedMarker?'Enabled':'Disabled'},
   SourceSelectionCriteria:{SseKmsEncryptedObjects:{Status:'Enabled'}},
   Destination:{Bucket:'arn:aws:s3:::'+scope.offsiteBucket,
    Account:wrongAccount?scope.sourceAccountId:scope.offsiteAccountId,
    EncryptionConfiguration:{ReplicaKmsKeyID:scope.offsiteKmsArn}}
  }]
 }});
 const key=(arn,account)=>({KeyMetadata:{
  Arn:arn,AWSAccountId:account,Enabled:!keyDisabled,
  KeyState:keyDisabled?'Disabled':'Enabled',
  KeySpec:'SYMMETRIC_DEFAULT',KeyUsage:'ENCRYPT_DECRYPT'
 }});
 function mock(account){
  return{send:async x=>{
   sent.push(x);
   if(networkDown)throw Error('offline');
   if(x.name==='GetBucketReplication')
    return replicationMissing?{}:response();
   if(x.name==='GetKeyRotationStatus')
    return{KeyRotationEnabled:!rotationDisabled};
   return key(account==='source'?scope.sourceKmsArn:scope.offsiteKmsArn,
    account==='source'?scope.sourceAccountId:scope.offsiteAccountId);
  }};
 }
 const x=createR172ReplicationAudit({
  ...scope,sourceS3:mock('source'),sourceKms:mock('source'),
  offsiteKms:mock('offsite'),commands,clock,allowExternalCalls:true
 });
 return{x,sent};
}
test('R172 cross-account immutable SSE-KMS offsite configuration and both rotating CMKs',async()=>{
 const f=fixture(),proof=await f.x.inspect();
 assert.equal(proof.inspected,true);
 assert.equal(proof.offsiteAccountId,scope.offsiteAccountId);
 assert.equal(proof.replicaDeliveryConfirmed,false);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(f.sent.length,5);
 assert.equal(verifyR172ReplicationAudit(proof,{
  sourceAccountId:scope.sourceAccountId,sourceBucket:scope.sourceBucket,
  offsiteAccountId:scope.offsiteAccountId,offsiteBucket:scope.offsiteBucket,clock
 }).configurationAccepted,true);
});
test('R172 refuses absent replication, public-account drift, delete marker, wrong role, missing rotation, key outage',async()=>{
 for(const opts of [
  {wrongAccount:true},{deletedMarker:true},{roleChanged:true},
  {replicationMissing:true},{rotationDisabled:true},
  {keyDisabled:true},{networkDown:true}
 ])await assert.rejects(fixture(opts).x.inspect(),/R172 cross-account resilience/);
 const proof=await fixture().x.inspect();
 assert.throws(()=>verifyR172ReplicationAudit(proof,{
  sourceAccountId:scope.sourceAccountId,sourceBucket:scope.sourceBucket,
  offsiteAccountId:scope.offsiteAccountId,offsiteBucket:scope.offsiteBucket,
  clock:()=>now+65000}),/R172 cross-account resilience/);
});
test('R172 rejects same AWS account or region and default disabled external access',async()=>{
 assert.throws(()=>createR172ReplicationAudit({
  ...scope,offsiteAccountId:scope.sourceAccountId
 }),/R172 cross-account resilience/);
 const dummy={send:async()=>{throw Error('unreachable');}};
 const off=createR172ReplicationAudit({
  ...scope,sourceS3:dummy,sourceKms:dummy,offsiteKms:dummy,
  commands,clock
 });
 await assert.rejects(off.inspect(),/disabled/);
});
