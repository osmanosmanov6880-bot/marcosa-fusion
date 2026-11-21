import test from 'node:test';
import assert from 'node:assert/strict';
import {createR169CloudPosture,verifyR169CloudPosture} from '../r169/cloud-posture.mjs';
const arn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const role='arn:aws:iam::111122223333:role/marcosa-staging-backup-role';
const base={accountId:'111122223333',region:'eu-west-1',
 bucket:'marcosa-ci-locked',kmsKeyArn:arn,assumedRoleArn:role};
const names=['GetBucketPolicyCommand','GetBucketEncryptionCommand',
 'GetBucketOwnershipControlsCommand','GetKeyPolicyCommand'];
const commands=Object.fromEntries(names.map(n=>[n,class{constructor(input){this.kind=n;this.input=input;}}]));
function create({weakTls=false,publicPrincipal=false,wrongKms=false,
 wrongOwner=false,missingContext=false,failNetwork=false}={}){
 const s3={async send(command){
  if(failNetwork)throw Error('offline');
  switch(command.kind){
   case 'GetBucketPolicyCommand':return {Policy:JSON.stringify({Version:'2012-10-17',
    Statement:[{Effect:'Deny',Principal:'*',Action:'s3:*',
     Resource:'arn:aws:s3:::marcosa-ci-locked/*',
     Condition:weakTls?{Bool:{'aws:SecureTransport':'true'}}:
      {Bool:{'aws:SecureTransport':'false'}}},
     {Effect:'Allow',Principal:{AWS:publicPrincipal?'*':role},
      Action:'s3:GetObject',Resource:'arn:aws:s3:::marcosa-ci-locked/marcosa/isolated/r168/*'}]})};
   case 'GetBucketEncryptionCommand':return {ServerSideEncryptionConfiguration:{Rules:[
    {ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'aws:kms',
     KMSMasterKeyID:wrongKms?'arn:aws:kms:us-east-1:111122223333:key/xx':arn}}]}};
   case 'GetBucketOwnershipControlsCommand':return {OwnershipControls:{Rules:[
    {ObjectOwnership:wrongOwner?'ObjectWriter':'BucketOwnerEnforced'}]}};
   default:throw Error('unexpected S3');
  }
 }};
 const kms={async send(){if(failNetwork)throw Error('offline');
  return{Policy:JSON.stringify({Version:'2012-10-17',Statement:[
   {Effect:'Allow',Principal:{AWS:role},
    Action:['kms:GenerateDataKey','kms:Decrypt'],
    Resource:'*',
    Condition:{StringEquals:{'kms:EncryptionContext:marcosa-scope':
     missingContext?'production':'isolated-staging-only'}}}]})};
 }};
 const input={...base,s3,kms,commands,allowExternalCalls:true,
  clock:()=>1800000000000};
 return{gate:createR169CloudPosture(input),input};
}
test('R169 posture checks real SDK-shaped bucket policy, KMS encryption, ownership and key context',async()=>{
 const f=create(),proof=await f.gate.inspect();
 assert.equal(proof.inspected,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(verifyR169CloudPosture(proof,f.input).passed,true);
});
test('R169 posture rejects public bucket, disabled TLS deny, weak encryption, ACLs and missing KMS context',async()=>{
 for(const x of [
  {weakTls:true},{publicPrincipal:true},{wrongKms:true},
  {wrongOwner:true},{missingContext:true},{failNetwork:true}
 ])await assert.rejects(create(x).gate.inspect(),/R169 cloud posture/);
 const f=create(),lease=await f.gate.inspect();
 assert.throws(()=>verifyR169CloudPosture(lease,{...f.input,
  clock:()=>1800000070000}),/configuration changed/);
 const off=createR169CloudPosture({...f.input,allowExternalCalls:false});
 await assert.rejects(off.inspect(),/disabled/);
});
