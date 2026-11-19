import test from 'node:test';
import assert from 'node:assert/strict';
import {createR172AwsIdentityAudit,verifyR172AwsIdentityAudit}
 from '../r172/aws-identity.mjs';
const accountId='111122223333',runId='44567891234',
 sourceRoleId='AROA'+'A'.repeat(16),clock=()=>1800000000000;
const sessionArn='arn:aws:sts::'+accountId+
 ':assumed-role/marcosa-staging-backup-role/marcosa-r170-'+runId;
const names=['GetCallerIdentity','GetOpenIDConnectProvider'];
const commands=Object.fromEntries(names.map(x=>[x+'Command',
 class{constructor(input){this.input=input;this.kind=x;}}]));
function fixture({wrongRole=false,wrongArn=false,otherAudience=false,
 badThumbprint=false,networkDown=false}={}){
 const calls=[];
 const stsClient={send:async c=>{
  calls.push(c);
  if(networkDown)throw Error('staging unavailable');
  return{Account:accountId,Arn:wrongArn?'arn:aws:sts::'+accountId+
   ':assumed-role/production/run':sessionArn,
   UserId:wrongRole?'AROA'+'B'.repeat(16)+':marcosa-r170-'+runId:
    sourceRoleId+':marcosa-r170-'+runId};
 }};
 const iamAuditorClient={send:async c=>{
  calls.push(c);
  if(networkDown)throw Error('denied');
  return{Url:'token.actions.githubusercontent.com',
   ClientIDList:otherAudience?['sts.amazonaws.com','api://extra']:
    ['sts.amazonaws.com'],
   ThumbprintList:badThumbprint?['unknown']:['a'.repeat(40)]};
 }};
 return{audit:createR172AwsIdentityAudit({
  stsClient,iamAuditorClient,commands,accountId,runId,sourceRoleId,
  expectedSessionArn:sessionArn,allowExternalCalls:true,clock
 }),calls};
}
test('R172 AWS exact STS caller role session and OIDC provider audience verified with official commands',async()=>{
 const f=fixture(),proof=await f.audit.inspect();
 assert.equal(proof.verified,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(proof.independentlyVerifiedAuditorPrincipal,false);
 assert.equal(f.calls.length,2);
 assert.equal(f.calls[1].input.OpenIDConnectProviderArn,
  'arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com');
 assert.equal(verifyR172AwsIdentityAudit(proof,{accountId,runId,
  sourceRoleId,expectedSessionArn:sessionArn,clock})
  .sessionBoundToExactRole,true);
});
test('R172 refuses forged STS identity, extra OIDC audiences, untrusted thumbprints and outages',async()=>{
 for(const opt of [
  {wrongRole:true},{wrongArn:true},{otherAudience:true},
  {badThumbprint:true},{networkDown:true}
 ])await assert.rejects(fixture(opt).audit.inspect(),/R172 AWS identity/);
 const proof=await fixture().audit.inspect();
 assert.throws(()=>verifyR172AwsIdentityAudit(proof,{accountId,runId,
  sourceRoleId,expectedSessionArn:sessionArn,
  clock:()=>1800000061000}),/R172 AWS identity/);
});
test('R172 cannot reach AWS without live operator opt in',async()=>{
 const a=createR172AwsIdentityAudit({
  stsClient:{send:async()=>{throw Error('no');}},
  iamAuditorClient:{send:async()=>{throw Error('no');}},
  commands,accountId,runId,sourceRoleId,
  expectedSessionArn:sessionArn,clock
 });
 await assert.rejects(a.inspect(),/disabled/);
});
