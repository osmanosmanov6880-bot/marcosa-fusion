/**
 * MARCOSA R182 — read-only IAM inspection with precise OIDC trust, inline
 * permissions and permissions boundary. No mutation or policy simulation
 * grants; effective rights / human identity still require external review.
 * The AWS executor can be real CLI (operator-only) or mocks (isolated CI).
 */
import {createHash} from 'node:crypto';
import {buildR178ReadOnlyIamBlueprint} from '../r178/iam-plan.mjs';
const fail=m=>{throw Error('R182 IAM posture: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 ACCOUNT=/^[0-9]{12}$/;
const ROLE='marcosa-r178-readonly-auditor';
const POLICY='marcosa-r182-staging-readonly';
const BOUNDARY='marcosa-staging-readonly-boundary';
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const stringify=x=>JSON.stringify(canon(x));
const digest=x=>createHash('sha256').update(stringify(x)).digest('hex');
function policy(x){
 if(typeof x==='object'&&x&&!Array.isArray(x))return x;
 if(typeof x!=='string'||x.length<8||x.length>30000)fail('policy document malformed');
 try{
  const decoded=x.startsWith('%7B')||x.includes('%22')?
   decodeURIComponent(x):x;
  const parsed=JSON.parse(decoded);
  ok(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),
   'policy is not a JSON object');
  return parsed;
 }catch{fail('IAM policy JSON invalid or double-encoded');}
}
const eq=(a,b)=>stringify(a)===stringify(b);
function scope(x){
 ok(x&&ACCOUNT.test(x.accountId||'')&&
  /^[A-Za-z0-9_-]{1,64}$/.test(x.profile||'')&&
  /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(x.region||'')&&
  typeof x.kmsKeyArn==='string'&&
  x.kmsKeyArn.startsWith('arn:aws:kms:'+x.region+':'+x.accountId+':key/'),
  'pin source/offsite profile, region and account');
}
export function createR182IamPostureAudit({source,offsite,executeAws,
 clock=()=>Date.now(),allowNetwork=false}={}){
 scope(source);scope(offsite);
 ok(source.profile!==offsite.profile&&
  source.accountId!==offsite.accountId&&
  typeof executeAws==='function'&&typeof clock==='function',
  'two different independently configured IAM profiles required');
 const blueprint=buildR178ReadOnlyIamBlueprint({source,offsite});
 async function call(target,operation,params){
  ok(allowNetwork===true,'real AWS IAM inspection disabled by default');
  let out;
  try{out=await executeAws({profile:target.profile,
   region:target.region,service:'iam',operation,params});}
  catch{fail('read-only IAM '+operation+' unavailable');}
  ok(out?.json&&Object.getPrototypeOf(out.json)===Object.prototype,
   'IAM must return structured read-only JSON');
  return out.json;
 }
 async function one(target,expected){
  const args={RoleName:ROLE};
  const [roleResponse,inlineNames,attachedNames,inline]=await Promise.all([
   call(target,'get-role',args),
   call(target,'list-role-policies',args),
   call(target,'list-attached-role-policies',args),
   call(target,'get-role-policy',{...args,PolicyName:POLICY})
  ]);
  const role=roleResponse.Role;
  const boundary='arn:aws:iam::'+target.accountId+':policy/'+BOUNDARY;
  ok(role?.Arn===expected.roleArn&&role.RoleName===ROLE&&
   role.PermissionsBoundary?.PermissionsBoundaryArn===boundary&&
   Number.isSafeInteger(role.MaxSessionDuration)&&
   role.MaxSessionDuration>=900&&role.MaxSessionDuration<=3600,
   'role ARN/session, pinned permissions boundary or trust unavailable');
  ok(eq(policy(role.AssumeRolePolicyDocument),expected.trustPolicy),
   'GitHub OIDC environment, audience or role trust drifted');
  ok(inlineNames?.IsTruncated===false&&
   Array.isArray(inlineNames.PolicyNames)&&
   inlineNames.PolicyNames.length===1&&
   inlineNames.PolicyNames[0]===POLICY&&
   attachedNames?.IsTruncated===false&&
   Array.isArray(attachedNames.AttachedPolicies)&&
   attachedNames.AttachedPolicies.length===0&&
   inline.RoleName===ROLE&&inline.PolicyName===POLICY,
   'inline policies expanded, attached policy introduced or pagination incomplete');
  ok(eq(policy(inline.PolicyDocument),expected.permissionsPolicy),
   'actual inline IAM permissions differ from reviewed no-write policy');
  return Object.freeze({accountId:target.accountId,
   roleArn:expected.roleArn,profile:target.profile,
   trustSha256:digest(expected.trustPolicy),
   permissionsSha256:digest(expected.permissionsPolicy),
   permissionsBoundaryArn:boundary,
   exactRoleTrustAndInlinePolicyObserved:true,
   effectivePermissionsProven:false});
 }
 async function inspect({commit,bundleSha256}={}){
  ok(allowNetwork===true&&H40.test(commit||'')&&H64.test(bundleSha256||''),
   'explicitly enabled source-bound read-only IAM inspection required');
  const started=clock();
  const [a,b]=await Promise.all([
   one(source,blueprint.plans[0]),one(offsite,blueprint.plans[1])
  ]);
  const finished=clock();
  ok(Number.isSafeInteger(started)&&Number.isSafeInteger(finished)&&
   finished>=started&&finished-started<=60000,
   'IAM inspection too slow for trusted staging evidence');
  const record={schemaVersion:1,commit,bundleSha256,
   source:a,offsite:b,blueprintSha256:blueprint.planSha256,
   checkedAtMs:finished,expiresAtMs:finished+60000,
   exactTwoRoleReadOnlyShapeMatched:true,
   effectiveIamRightsIndependentlyVerified:false,
   permissionsBoundaryPolicyContentInspected:false,
   realHumanIdentityVerified:false,
   productionAuthorized:false};
  return Object.freeze({...record,evidenceSha256:digest(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,networkEnabled:allowNetwork,productionAuthorized:false})});
}
export const R182_IAM_COMMANDS=Object.freeze([
 'get-role','list-role-policies','list-attached-role-policies',
 'get-role-policy'
]);
