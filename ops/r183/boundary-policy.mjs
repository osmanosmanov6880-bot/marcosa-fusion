/**
 * R183 read-only IAM boundary *document* check in each independent account.
 * A boundary limits permissions; it does not confer them, and comparing
 * documents does NOT establish effective privileges, SCPs or KMS key policy.
 * A fake read-only executor is injected in CI; real call is operator-only.
 */
import {createHash} from 'node:crypto';
import {buildR178ReadOnlyIamBlueprint} from '../r178/iam-plan.mjs';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R183 IAM boundary: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const sha=x=>createHash('sha256').update(JSON.stringify(canon(x))).digest('hex');
const account=x=>x&&/^[0-9]{12}$/.test(x.accountId||'')&&
 /^[A-Za-z0-9_-]{1,64}$/.test(x.profile||'')&&
 /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9-]{36}$/.test(x.kmsKeyArn||'');
function decoded(v){
 if(v&&typeof v==='object'&&!Array.isArray(v))return v;
 ok(typeof v==='string'&&v.length>=12&&v.length<=30000,
  'IAM permissions boundary JSON absent');
 try{
  const json=v.trim().startsWith('{')?v:decodeURIComponent(v);
  const parsed=JSON.parse(json);
  ok(parsed&&Object.getPrototypeOf(parsed)===Object.prototype,
   'IAM policy must be a JSON document');
  return parsed;
 }catch{fail('IAM boundary malformed or double encoded');}
}
export function createR183BoundaryAudit({source,offsite,
 executeAws,clock=()=>Date.now(),allowNetwork=false}={}){
 ok(account(source)&&account(offsite)&&
  source.accountId!==offsite.accountId&&
  source.profile!==offsite.profile&&
  typeof executeAws==='function'&&typeof clock==='function',
  'two separate IAM boundary reader accounts required');
 const blueprint=buildR178ReadOnlyIamBlueprint({source,offsite});
 async function call(target,operation,params){
  ok(allowNetwork===true,'IAM boundary read-only network disabled');
  let response;
  try{response=await executeAws({profile:target.profile,
   region:target.region,service:'iam',operation,params});}
  catch{fail('IAM boundary read failed or access denied');}
  ok(response?.json&&Object.getPrototypeOf(response.json)===Object.prototype,
   'IAM read-only default policy/version JSON required');
  return response.json;
 }
 async function inspect({commit,bundleSha256,iamProof}={}){
  ok(allowNetwork===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&
   iamProof?.commit===commit&&iamProof.bundleSha256===bundleSha256&&
   iamProof.exactTwoRoleReadOnlyShapeMatched===true&&
   iamProof.permissionsBoundaryPolicyContentInspected===false&&
   iamProof.effectiveIamRightsIndependentlyVerified===false&&
   iamProof.productionAuthorized===false,
   'R182 source-bound IAM role observations required first');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>=iamProof.checkedAtMs&&
   now<=iamProof.expiresAtMs,
   'IAM role inspection expired before boundary read');
  async function one(target,plan,old){
   const arn='arn:aws:iam::'+target.accountId+
    ':policy/marcosa-staging-readonly-boundary';
   ok(old?.accountId===target.accountId&&
    old.permissionsBoundaryArn===arn&&
    old.exactRoleTrustAndInlinePolicyObserved===true,
    'role inspection did not match pinned boundary ARN');
   const policy=(await call(target,'get-policy',{PolicyArn:arn})).Policy;
   const version=policy?.DefaultVersionId;
   ok(policy?.Arn===arn&&
    /^v[1-9][0-9]{0,2}$/.test(version||'')&&
    policy.IsAttachable===true&&
    policy.AttachmentCount>=1&&policy.AttachmentCount<=12,
    'default IAM boundary policy/version missing or detached');
   const v=(await call(target,'get-policy-version',{
    PolicyArn:arn,VersionId:version
   })).PolicyVersion;
   ok(v?.VersionId===version&&v?.IsDefaultVersion===true&&
    JSON.stringify(canon(decoded(v.Document)))===
     JSON.stringify(canon(plan.permissionsPolicy)),
    'read-only default permissions boundary differs from pinned blueprint');
   return Object.freeze({accountId:target.accountId,
    boundaryPolicyArn:arn,defaultVersionId:version,
    boundaryDocumentSha256:sha(plan.permissionsPolicy),
    exactDefaultBoundaryPolicyObserved:true,
    effectiveRightsEstablished:false});
  }
  const [a,b]=await Promise.all([
   one(source,blueprint.plans[0],iamProof.source),
   one(offsite,blueprint.plans[1],iamProof.offsite)
  ]);
  const observed=clock();
  ok(Number.isSafeInteger(observed)&&observed>=now&&observed-now<=60000,
   'two-account IAM boundary inspection timed out');
  const record={
   schemaVersion:1,repository:REPO,commit,bundleSha256,
   iamEvidenceSha256:iamProof.evidenceSha256,
   source:a,offsite:b,checkedAtMs:observed,
   expiresAtMs:observed+60000,
   twoDefaultBoundaryPolicyDocumentsMatched:true,
   iamEffectivePermissionsIndependentlyVerified:false,
   organizationScpAndResourcePoliciesVerified:false,
   actualCloudProviderIndependentlyAuthenticated:false,
   naturalHumanApprovalsVerified:false,
   productionAuthorized:false
  };
  return Object.freeze({...record,evidenceSha256:sha(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,enabled:allowNetwork,productionAuthorized:false})});
}
