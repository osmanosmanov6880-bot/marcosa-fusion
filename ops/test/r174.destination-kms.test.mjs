import test from 'node:test';
import assert from 'node:assert/strict';
import {createR174DestinationKmsAudit,r174PolicyHash,
 r174InspectKmsPolicyDocument} from '../r174/destination-kms.mjs';
const accountId='444455556666',region='eu-central-1',
 keyArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab',
 approvedRoleArn='arn:aws:iam::444455556666:role/marcosa-staging-backup-role',
 now=1800000000000,clock=()=>now;
const condition={StringEquals:{'kms:EncryptionContext:marcosa-scope':'isolated-staging-only'}};
const policy={Version:'2012-10-17',Statement:[
 {Sid:'OnlyStagingDEK',Effect:'Allow',Principal:{AWS:approvedRoleArn},
  Action:['kms:Encrypt','kms:Decrypt','kms:DescribeKey'],Resource:'*',Condition:condition},
 {Sid:'NeverDisableOffsite',Effect:'Deny',Principal:'*',
  Action:['kms:DisableKey','kms:ScheduleKeyDeletion'],Resource:'*'}
]};
const approvedPolicySha256=r174PolicyHash(policy);
const commands=Object.fromEntries([
 'DescribeKey','GetKeyPolicy','GetKeyRotationStatus','ListGrants'
].map(x=>[x+'Command',class{constructor(input){this.input=input;this.kind=x;}}]));
function fixture({admin=false,grant=false,truncated=false,disabled=false,
 rotationOff=false,wrongKey=false,wrongPrincipal=false,networkError=false}={}){
 const sent=[];
 const altered=JSON.parse(JSON.stringify(policy));
 if(admin)altered.Statement[0].Action.push('kms:*');
 if(wrongPrincipal)altered.Statement[0].Principal.AWS='*';
 const client={send:async cmd=>{
  sent.push(cmd);
  if(networkError)throw Error('AWS network down');
  switch(cmd.kind){
  case 'DescribeKey':return{KeyMetadata:{
   Arn:wrongKey?keyArn.replace('4567abcd','9999abcd'):keyArn,
   AWSAccountId:accountId,KeyState:disabled?'Disabled':'Enabled',
   Enabled:!disabled,KeyManager:'CUSTOMER',Origin:'AWS_KMS',
   KeyUsage:'ENCRYPT_DECRYPT',KeySpec:'SYMMETRIC_DEFAULT',
   MultiRegion:false}};
  case 'GetKeyPolicy':return{Policy:encodeURIComponent(JSON.stringify(altered))};
  case 'GetKeyRotationStatus':return{KeyRotationEnabled:!rotationOff};
  case 'ListGrants':return{Grants:grant?[{GranteePrincipal:'*'}]:[],
   Truncated:truncated,NextMarker:truncated?'more':undefined};
  default:throw Error('unknown KMS command');
  }
 }};
 return{sent,audit:createR174DestinationKmsAudit({
  client,commands,keyArn,accountId,region,approvedRoleArn,
  approvedPolicySha256,clock,allowExternalCalls:true})};
}
test('R174 validates pinned offsite key policy, denies key deletion and forbids grants',async()=>{
 const f=fixture(),proof=await f.audit.inspect();
 assert.equal(proof.checked,true);
 assert.equal(proof.policySha256,approvedPolicySha256);
 assert.equal(proof.noUnexpectedGrants,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(proof.realAwsAccountUsed,false);
 assert.equal(f.sent.length,4);
 assert.equal(f.sent[0].input.KeyId,keyArn);
 assert.equal(r174InspectKmsPolicyDocument(policy,approvedRoleArn).decryptScoped,true);
});
test('R174 refuses expanded KMS permissions, wildcards, unexpected grants, pagination, rotation and key lifecycle',async()=>{
 for(const q of [
  {admin:true},{wrongPrincipal:true},{grant:true},{truncated:true},
  {disabled:true},{rotationOff:true},{wrongKey:true},{networkError:true}
 ])await assert.rejects(fixture(q).audit.inspect(),/R174 destination KMS policy/);
});
test('R174 rejects policy mismatch and unapproved real network',async()=>{
 assert.throws(()=>createR174DestinationKmsAudit({
  client:{send:async()=>{}},commands,keyArn,accountId,region,approvedRoleArn,
  approvedPolicySha256:'not-sha'
 }),/R174 destination KMS policy/);
 const f=createR174DestinationKmsAudit({
  client:{send:async()=>{throw Error('unexpected network');}},
  commands,keyArn,accountId,region,approvedRoleArn,approvedPolicySha256
 });
 await assert.rejects(f.inspect(),/disabled/);
});
