import test from 'node:test';
import assert from 'node:assert/strict';
import {r170IamCanaries,createR170IamSimulator,verifyR170IamSimulation}
 from '../r170/iam-simulator.mjs';
const now=1800000000000,clock=()=>now,accountId='111122223333',
 bucket='marcosa-ci-locked',archiveSha256='a'.repeat(64),
 kmsKeyArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
class SimulatePrincipalPolicyCommand{constructor(input){this.input=input;}}
function f({wrongAction=false,truncated=false,allowDelete=false,missingContext=false}={}){
 const seen=[];
 const client={send:async cmd=>{
  const i=cmd.input;seen.push(i);
  const isNegative=i.ActionNames[0]==='s3:DeleteObjectVersion'||
   i.ActionNames[0]==='s3:BypassGovernanceRetention'||
   i.ActionNames[0]==='s3:PutBucketPolicy'||
   i.ActionNames[0]==='kms:ScheduleKeyDeletion'||
   i.ResourceArns[0].includes('/marcosa/production/')||
   i.ContextEntries?.some(e=>e.ContextKeyValues.includes('production'));
  const actual=isNegative?(allowDelete?'allowed':'explicitDeny'):'allowed';
  return{IsTruncated:truncated,
   EvaluationResults:[{EvalActionName:wrongAction?'s3:DeleteBucket':i.ActionNames[0],
    EvalResourceName:i.ResourceArns[0],EvalDecision:actual,
    MissingContextValues:missingContext?['kms:EncryptionContext:marcosa-scope']:[],
    ResourceSpecificResults:[{EvalResourceName:i.ResourceArns[0],
     EvalResourceDecision:actual}],
    PermissionsBoundaryDecisionDetail:{AllowedByPermissionsBoundary:true},
    OrganizationsDecisionDetail:{AllowedByOrganizations:true}}]};
 }};
 const inspector=createR170IamSimulator({client,
  commands:{SimulatePrincipalPolicyCommand},accountId,bucket,kmsKeyArn,
  archiveSha256,allowExternalCalls:true,clock});
 return{inspector,seen};
}
test('R170 IAM SDK-v3 canaries inspect exact scoped positive and negative resource decisions',async()=>{
 const x=f(),proof=await x.inspector.inspect();
 assert.equal(proof.checked,true);
 assert.equal(proof.allowed,7);
 assert.equal(proof.denied,6);
 assert.equal(proof.checks,13);
 assert.equal(x.seen.length,13);
 assert.equal(x.seen[0].PolicySourceArn,
  'arn:aws:iam::111122223333:role/marcosa-staging-backup-role');
 assert.equal(proof.effectiveServiceAuthorizationEstablished,false);
 assert.equal(verifyR170IamSimulation(proof,{accountId,bucket,kmsKeyArn,
  archiveSha256,clock}).canaryChecksVerified,true);
});
test('R170 refuses partial, wrong action, surprising allow on delete, missing context and expired proof',async()=>{
 for(const opt of [{wrongAction:true},{truncated:true},
  {allowDelete:true},{missingContext:true}]){
  await assert.rejects(f(opt).inspector.inspect(),/R170 IAM simulation/);
 }
 const out=await f().inspector.inspect();
 assert.throws(()=>verifyR170IamSimulation(out,{accountId,bucket,kmsKeyArn,
  archiveSha256,clock:()=>now+70000}),/R170 IAM simulation/);
 assert.throws(()=>r170IamCanaries({accountId,bucket,kmsKeyArn,
  archiveSha256:'0'}),/R170 IAM simulation/);
});
test('R170 default IAM inspector never accesses the network',async()=>{
 const network=createR170IamSimulator({
  client:{send:async()=>{throw Error('should not run');}},
  commands:{SimulatePrincipalPolicyCommand},accountId,bucket,kmsKeyArn,
  archiveSha256,clock});
 await assert.rejects(network.inspect(),/network disabled/);
});
