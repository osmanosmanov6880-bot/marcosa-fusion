import test from 'node:test';
import assert from 'node:assert/strict';
import {createR168AwsPreflight,verifyR168Readiness} from '../r168/aws-preflight.mjs';
const arn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const roleArn='arn:aws:sts::111122223333:assumed-role/marcosa-staging-backup-role/ci-r168-check';
const names=['GetCallerIdentityCommand','DescribeKeyCommand','GetBucketVersioningCommand',
 'GetObjectLockConfigurationCommand','GetPublicAccessBlockCommand','GetBucketLocationCommand'];
const commands=Object.fromEntries(names.map(name=>[name,class{constructor(input){this.input=input;this.name=name;}}]));
function setup({deny=null,publicBucket=false,wrongRole=false,disabledKey=false,governance=false}={}){
 const calls=[];
 const aws={send:async c=>{
  calls.push(c);
  if(c.name===deny)throw Error('permission denied');
  switch(c.name){
   case 'GetCallerIdentityCommand':return{Account:'111122223333',
    Arn:wrongRole?'arn:aws:sts::111122223333:assumed-role/other/ci':roleArn};
   case 'DescribeKeyCommand':return{KeyMetadata:{Arn:arn,
    AWSAccountId:'111122223333',KeyState:disabledKey?'Disabled':'Enabled',
    Enabled:!disabledKey,KeyUsage:'ENCRYPT_DECRYPT',KeySpec:'SYMMETRIC_DEFAULT'}};
   case 'GetBucketLocationCommand':return{LocationConstraint:'eu-west-1'};
   case 'GetBucketVersioningCommand':return{Status:'Enabled'};
   case 'GetObjectLockConfigurationCommand':return{ObjectLockConfiguration:{
    ObjectLockEnabled:'Enabled',Rule:{DefaultRetention:{
     Mode:governance?'GOVERNANCE':'COMPLIANCE',Days:7}}}};
   case 'GetPublicAccessBlockCommand':return{PublicAccessBlockConfiguration:{
    BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:!publicBucket,
    RestrictPublicBuckets:true}};
   default:throw Error('unsupported');
  }
 }};
 const input={sts:aws,s3:aws,kms:aws,commands,region:'eu-west-1',
  accountId:'111122223333',bucket:'marcosa-ci-locked',
  kmsKeyArn:arn,allowExternalCalls:true,clock:()=>1800000000000};
 return{gate:createR168AwsPreflight(input),input,calls};
}
test('R168 preflight accepts exact assumed-role, pinned enabled KMS and compliance-locked private S3',async()=>{
 const x=setup();
 const lease=await x.gate.inspect();
 assert.equal(lease.passed,true);
 assert.equal(lease.productionAuthorized,false);
 assert.equal(x.calls.length,6);
 assert.equal(x.calls.find(c=>c.name==='DescribeKeyCommand').input.KeyId,arn);
 assert.equal(verifyR168Readiness(lease,{...x.input}).allowedForSyntheticStaging,true);
});
test('R168 fail-closed for wrong assumed role, disabled key, public bucket, governance and failed permissions',async()=>{
 for(const variant of [
  {wrongRole:true},{disabledKey:true},{publicBucket:true},
  {governance:true},{deny:'GetBucketVersioningCommand'}
 ]){
  await assert.rejects(setup(variant).gate.inspect(),/R168 AWS preflight/);
 }
 const x=setup(),lease=await x.gate.inspect();
 assert.throws(()=>verifyR168Readiness(lease,{...x.input,clock:()=>1800000070000}),/stale/);
 assert.throws(()=>verifyR168Readiness(lease,{...x.input,bucket:'another'}),/mis-scoped/);
 const off=createR168AwsPreflight({...x.input,allowExternalCalls:false});
 await assert.rejects(off.inspect(),/disabled/);
});
