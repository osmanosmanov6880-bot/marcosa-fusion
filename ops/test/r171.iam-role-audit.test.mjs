import test from 'node:test';
import assert from 'node:assert/strict';
import {createR169IamPlan,r169GitHubOidcSubject} from '../r169/iam-plan.mjs';
import {createR171IamRoleAudit,verifyR171IamRoleAudit} from '../r171/iam-role-audit.mjs';
const now=1800000000000,clock=()=>now;
const args={accountId:'111122223333',region:'eu-west-1',
 bucketName:'marcosa-ci-locked',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
const plan=createR169IamPlan({...args,expectedOidcSubject:r169GitHubOidcSubject(args)});
const boundaryArn='arn:aws:iam::111122223333:policy/marcosa-staging-deny-boundary';
const roleId='AROA'+'A'.repeat(16);
const classes=Object.fromEntries([
 'GetRole','ListRolePolicies','GetRolePolicy','ListAttachedRolePolicies',
 'GetPolicy','GetPolicyVersion'
].map(x=>[x+'Command',class{constructor(input){this.name=x;this.input=input;}}]));
const doc=x=>encodeURIComponent(JSON.stringify(x));
function make({extraPolicy=false,attached=false,wrongTrust=false,
 weakBoundary=false,wrongInline=false,truncated=false,networkFailure=false}={}){
 const calls=[];
 const client={send:async x=>{
  calls.push(x);
  if(networkFailure)throw Error('AWS permissions');
  switch(x.name){
  case 'GetRole':return{Role:{Arn:plan.AWS_ROLE_ARN,RoleId:roleId,
   RoleName:plan.roleName,Path:'/',MaxSessionDuration:3600,
   PermissionsBoundary:{PermissionsBoundaryType:'PermissionsBoundary',
    PermissionsBoundaryArn:boundaryArn},
   AssumeRolePolicyDocument:doc(wrongTrust?{Version:'2012-10-17',
    Statement:[{Effect:'Allow',Action:'sts:AssumeRoleWithWebIdentity',
     Resource:'*'}]}:plan.trustPolicy)}};
  case 'ListRolePolicies':return{PolicyNames:extraPolicy?
   ['marcosa-staging-backup-inline','extra-admin']:
   ['marcosa-staging-backup-inline'],IsTruncated:truncated};
  case 'ListAttachedRolePolicies':return{AttachedPolicies:attached?
   [{PolicyName:'AdministratorAccess',PolicyArn:'arn:aws:iam::aws:policy/AdministratorAccess'}]:
   [],IsTruncated:false};
  case 'GetRolePolicy':return{RoleName:plan.roleName,
   PolicyName:'marcosa-staging-backup-inline',
   PolicyDocument:doc(wrongInline?{Version:'2012-10-17',
    Statement:[{Effect:'Allow',Action:['s3:*'],Resource:'*'}]}:plan.permissionsPolicy)};
  case 'GetPolicy':return{Policy:{Arn:boundaryArn,IsAttachable:true,
   DefaultVersionId:'v1',AttachmentCount:1}};
  case 'GetPolicyVersion':return{PolicyVersion:{
   IsDefaultVersion:true,Document:doc(weakBoundary?{
    Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'*',Resource:'*'}]
   }:plan.permissionsPolicy)}};
  default:throw Error('unexpected');
  }
 }};
 const inspect=createR171IamRoleAudit({client,commands:classes,plan,boundaryArn,
  allowExternalCalls:true,clock});
 return{inspect,calls};
}
test('R171 actual IAM read-only SDK GetRole/inline/attached/boundary contracts match exact trust',async()=>{
 const x=make(),p=await x.inspect.inspect();
 assert.equal(p.checked,true);
 assert.equal(p.inlinePolicyCount,1);
 assert.equal(p.attachedManagedPolicyCount,0);
 assert.equal(p.sourceTrustSha256.length,64);
 assert.equal(p.serviceEffectivePermissionsProven,false);
 assert.equal(p.productionAuthorized,false);
 assert.equal(x.calls.length,6);
 assert.equal(verifyR171IamRoleAudit(p,{plan,boundaryArn,clock})
  .effectivePermissionsRemainUnproven,true);
});
test('R171 rejects expanded IAM trust, extra managed privilege, boundary drift, pagination and expired review',async()=>{
 for(const patch of [{extraPolicy:true},{attached:true},{wrongTrust:true},
  {weakBoundary:true},{wrongInline:true},{truncated:true},
  {networkFailure:true}]){
  await assert.rejects(make(patch).inspect.inspect(),/R171 IAM role audit/);
 }
 const p=await make().inspect.inspect();
 assert.throws(()=>verifyR171IamRoleAudit(p,{plan,boundaryArn,
  clock:()=>now+65000}),/R171 IAM role audit/);
});
test('R171 IAM role audit cannot initiate network when disabled',async()=>{
 const x=createR171IamRoleAudit({client:{send:async()=>{throw Error('network');}},
  commands:classes,plan,boundaryArn,clock});
 await assert.rejects(x.inspect(),/network disabled/);
});
