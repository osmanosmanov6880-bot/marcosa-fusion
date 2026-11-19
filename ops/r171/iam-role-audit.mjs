/**
 * R171 read-only live IAM role/trust/inline/permissions-boundary comparison.
 * Unlike SimulatePrincipalPolicy this inspects actual IAM role configuration.
 * Still cannot prove SCPs, S3/KMS resource policies or effective authorization.
 * No role/policy creation, attachment, mutation or privilege simulation here.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const ROLE='marcosa-staging-backup-role';
const fail=m=>{throw Error('R171 IAM role audit: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const BOUNDARY=/^arn:aws:iam::([0-9]{12}):policy\/marcosa-staging-deny-boundary$/;
function parsePolicy(raw){
 let obj=raw;
 if(typeof obj==='string'){
  ok(obj.length>0&&obj.length<30000,'bounded AWS policy document required');
  try{
   obj=JSON.parse(obj);
  }catch{
   try{obj=JSON.parse(decodeURIComponent(obj));}
   catch{fail('AWS policy document malformed or double encoded');}
  }
 }
 ok(obj&&Object.getPrototypeOf(obj)===Object.prototype&&
  obj.Version==='2012-10-17'&&Array.isArray(obj.Statement)&&
  obj.Statement.length>0&&obj.Statement.length<=32,
  'versioned IAM JSON policy required');
 return obj;
}
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'){
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 }
 return value;
}
const bytes=x=>Buffer.from(JSON.stringify(canonical(x)));
const hash=x=>createHash('sha256').update(bytes(x)).digest('hex');
function equalDoc(raw,expected){
 const actual=bytes(parsePolicy(raw)),want=bytes(parsePolicy(expected));
 return actual.length===want.length&&timingSafeEqual(actual,want);
}
export function createR171IamRoleAudit({client,commands,plan,
 boundaryArn,clock=()=>Date.now(),allowExternalCalls=false}={}){
 ok(plan&&plan.roleName===ROLE&&plan.policyApplied===false&&
  plan.productionAuthorized===false&&
  typeof plan.accountId==='string'&&
  plan.AWS_ROLE_ARN==='arn:aws:iam::'+plan.accountId+':role/'+ROLE&&
  BOUNDARY.test(boundaryArn||'')&&BOUNDARY.exec(boundaryArn)[1]===plan.accountId&&
  client&&typeof client.send==='function'&&commands&&
  ['GetRoleCommand','ListRolePoliciesCommand','GetRolePolicyCommand',
   'ListAttachedRolePoliciesCommand','GetPolicyCommand',
   'GetPolicyVersionCommand'].every(k=>typeof commands[k]==='function')&&
  typeof clock==='function',
  'pinned IAM audit target, role, boundary and SDK v3 read-only commands');
 const names={role:ROLE,inline:'marcosa-staging-backup-inline'};
 async function request(Name,input){
  ok(allowExternalCalls===true,'IAM network disabled without approved isolated staging');
  try{
   return await client.send(new commands[Name+'Command'](input),{
    abortSignal:AbortSignal.timeout(8500)
   });
  }catch{fail('IAM read-only request failed closed: '+Name);}
 }
 async function inspect(){
  ok(allowExternalCalls===true,'IAM audit network disabled');
  const [roleResult,inlineList,attachedList]=await Promise.all([
   request('GetRole',{RoleName:names.role}),
   request('ListRolePolicies',{RoleName:names.role,MaxItems:100}),
   request('ListAttachedRolePolicies',{RoleName:names.role,MaxItems:100})
  ]);
  const role=roleResult?.Role;
  ok(role&&role.Arn===plan.AWS_ROLE_ARN&&
   /^AROA[A-Z0-9]{16}$/.test(role.RoleId||'')&&
   role.RoleName===ROLE&&role.Path==='/'&&
   Number.isInteger(role.MaxSessionDuration)&&role.MaxSessionDuration<=3600&&
   role.MaxSessionDuration>=900&&
   role.PermissionsBoundary?.PermissionsBoundaryType==='PermissionsBoundary'&&
   role.PermissionsBoundary.PermissionsBoundaryArn===boundaryArn&&
   equalDoc(role.AssumeRolePolicyDocument,plan.trustPolicy),
   'role ARN, trusted OIDC subject, max-session or boundary drift');
  ok(inlineList?.IsTruncated===false&&
   Array.isArray(inlineList.PolicyNames)&&
   inlineList.PolicyNames.length===1&&
   inlineList.PolicyNames[0]===names.inline&&
   attachedList?.IsTruncated===false&&
   Array.isArray(attachedList.AttachedPolicies)&&
   attachedList.AttachedPolicies.length===0,
   'extra inline/attached policies or partial IAM listing');
  const [inlineDoc,boundaryDetails]=await Promise.all([
   request('GetRolePolicy',{RoleName:names.role,PolicyName:names.inline}),
   request('GetPolicy',{PolicyArn:boundaryArn})
  ]);
  ok(inlineDoc?.RoleName===ROLE&&
   inlineDoc.PolicyName===names.inline&&
   equalDoc(inlineDoc.PolicyDocument,plan.permissionsPolicy),
   'inline policy not byte-semantically identical to reviewed source');
  const policy=boundaryDetails?.Policy;
  ok(policy?.Arn===boundaryArn&&policy?.IsAttachable===true&&
   /^[v][1-9][0-9]{0,2}$/.test(policy.DefaultVersionId||'')&&
   policy.AttachmentCount>=1&&Number.isSafeInteger(policy.AttachmentCount),
   'permission boundary missing, unattached or version ambiguous');
  const bv=await request('GetPolicyVersion',{
   PolicyArn:boundaryArn,VersionId:policy.DefaultVersionId
  });
  ok(bv?.PolicyVersion?.IsDefaultVersion===true&&
   equalDoc(bv.PolicyVersion.Document,plan.permissionsPolicy),
   'permission boundary does not enforce exact reviewed allow/deny contract');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted inspection timestamp');
  return Object.freeze({
   checked:true,roleArn:plan.AWS_ROLE_ARN,accountId:plan.accountId,
   boundaryArn,roleId:role.RoleId,
   sourceTrustSha256:hash(plan.trustPolicy),
   sourceInlineSha256:hash(plan.permissionsPolicy),
   boundaryVersion:policy.DefaultVersionId,
   inlinePolicyCount:1,attachedManagedPolicyCount:0,
   exactTrustPolicyConfirmed:true,exactInlinePolicyConfirmed:true,
   exactPermissionsBoundaryConfirmed:true,
   reviewedAtMs:now,expiresAtMs:now+60000,
   serviceEffectivePermissionsProven:false,
   awsScpConfigurationIndependentlyAudited:false,
   productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  readOnly:true,roleArn:plan.AWS_ROLE_ARN,boundaryArn,
  networkEnabled:allowExternalCalls,productionAuthorized:false
 })});
}
export function verifyR171IamRoleAudit(proof,{plan,boundaryArn,clock=()=>Date.now()}={}){
 const now=clock();
 ok(plan&&proof&&proof.checked===true&&
  proof.roleArn===plan.AWS_ROLE_ARN&&
  proof.accountId===plan.accountId&&
  proof.boundaryArn===boundaryArn&&
  proof.sourceTrustSha256===hash(plan.trustPolicy)&&
  proof.sourceInlineSha256===hash(plan.permissionsPolicy)&&
  proof.inlinePolicyCount===1&&proof.attachedManagedPolicyCount===0&&
  proof.exactTrustPolicyConfirmed===true&&
  proof.exactInlinePolicyConfirmed===true&&
  proof.exactPermissionsBoundaryConfirmed===true&&
  proof.serviceEffectivePermissionsProven===false&&
  proof.awsScpConfigurationIndependentlyAudited===false&&
  proof.productionAuthorized===false&&
  Number.isSafeInteger(now)&&now>=proof.reviewedAtMs&&
  now<=proof.expiresAtMs&&proof.expiresAtMs-proof.reviewedAtMs<=60000,
  'IAM read-only review missing, stale or modified');
 return Object.freeze({liveIamConfigurationCanBeReviewed:true,
  effectivePermissionsRemainUnproven:true,productionAuthorized:false});
}
