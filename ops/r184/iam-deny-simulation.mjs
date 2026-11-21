/**
 * R184 read-only IAM SimulatePrincipalPolicy probe for dangerous write
 * actions on precisely scoped S3/KMS/IAM resources in two accounts.
 *
 * Simulation is informative, not authoritative effective access: SCP,
 * endpoint policies, resource-based grants, session policies and provider
 * credentials are NOT independently attested. A real denied simulation
 * cannot authorize production or even a real pilot.
 *
 * CI uses an injected synthetic AWS executor. The real AWS CLI adapter
 * permits precisely these read-only simulations when operator opts in.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R184 IAM deny simulation: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ACTIONS=Object.freeze([
 {action:'s3:PutObject',resource:'OBJECT'},
 {action:'s3:DeleteObject',resource:'OBJECT'},
 {action:'s3:PutBucketReplication',resource:'BUCKET'},
 {action:'s3:PutBucketPolicy',resource:'BUCKET'},
 {action:'kms:CreateGrant',resource:'KMS'},
 {action:'kms:DisableKey',resource:'KMS'},
 {action:'kms:ScheduleKeyDeletion',resource:'KMS'},
 {action:'iam:PassRole',resource:'ROLE'},
 {action:'iam:PutRolePolicy',resource:'ROLE'},
 {action:'iam:UpdateAssumeRolePolicy',resource:'ROLE'}
]);
const scope=x=>x&&/^[0-9]{12}$/.test(x.accountId||'')&&
 /^[A-Za-z0-9_-]{1,64}$/.test(x.profile||'')&&
 /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(x.region||'')&&
 /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(x.bucket||'')&&
 x.kmsKeyArn?.startsWith('arn:aws:kms:'+x.region+':'+x.accountId+':key/');
const role=t=>'arn:aws:iam::'+t.accountId+
 ':role/marcosa-r178-readonly-auditor';
function resource(target,kind){
 const bucket='arn:aws:s3:::'+target.bucket;
 if(kind==='BUCKET')return bucket;
 if(kind==='OBJECT')return bucket+'/marcosa/isolated/r178/archive/r184-probe.bin';
 if(kind==='KMS')return target.kmsKeyArn;
 return role(target);
}
export const R184_FORBIDDEN_ACTIONS=ACTIONS;
export function createR184IamDenyProbe({source,offsite,executeAws,
 clock=()=>Date.now(),allowNetwork=false}={}){
 ok(scope(source)&&scope(offsite)&&
  source.accountId!==offsite.accountId&&
  source.profile!==offsite.profile&&
  typeof executeAws==='function'&&typeof clock==='function',
  'separate exact profiles and read-only policy simulator required');
 async function check(target,entry){
  ok(allowNetwork===true,'real AWS policy simulation disabled');
  const res=resource(target,entry.resource);
  let response;
  try{
   response=await executeAws({profile:target.profile,
    region:target.region,service:'iam',
    operation:'simulate-principal-policy',
    params:{PolicySourceArn:role(target),
     ActionNames:entry.action,ResourceArns:res}});
  }catch{fail('IAM simulated write denial unavailable or API refused');}
  const body=response?.json;
  ok(body&&Object.getPrototypeOf(body)===Object.prototype&&
   body.IsTruncated===false&&
   Array.isArray(body.EvaluationResults)&&
   body.EvaluationResults.length===1,
   'policy simulator missing or paginated result');
  const decision=body.EvaluationResults[0];
  ok(decision.EvalActionName===entry.action&&
   decision.EvalResourceName===res&&
   ['implicitDeny','explicitDeny'].includes(decision.EvalDecision)&&
   Array.isArray(decision.MissingContextValues)&&
   decision.MissingContextValues.length===0&&
   (!('ResourceSpecificResults' in decision)||
    (Array.isArray(decision.ResourceSpecificResults)&&
     decision.ResourceSpecificResults.length===0)),
   'write operation allowed, missing IAM context, stale resource or partial result');
  return{action:entry.action,resource:entry.resource,
   decision:decision.EvalDecision};
 }
 async function inspect({commit,bundleSha256,iamProof,boundaryProof}={}){
  ok(allowNetwork===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&
   iamProof?.commit===commit&&iamProof.bundleSha256===bundleSha256&&
   iamProof.exactTwoRoleReadOnlyShapeMatched===true&&
   iamProof.effectiveIamRightsIndependentlyVerified===false&&
   iamProof.productionAuthorized===false&&
   boundaryProof?.commit===commit&&
   boundaryProof.bundleSha256===bundleSha256&&
   boundaryProof.iamEvidenceSha256===iamProof.evidenceSha256&&
   boundaryProof.twoDefaultBoundaryPolicyDocumentsMatched===true&&
   boundaryProof.iamEffectivePermissionsIndependentlyVerified===false&&
   boundaryProof.productionAuthorized===false,
   'pinned IAM role AND boundary evidence are prerequisites');
  const start=clock();
  const data=[];
  for(const [t,observed] of [[source,iamProof.source],
    [offsite,iamProof.offsite]]){
   ok(observed?.accountId===t.accountId&&
    observed.roleArn===role(t)&&
    observed.exactRoleTrustAndInlinePolicyObserved===true,
    'read-only role drift in selected AWS account');
   const rows=[];
   for(const entry of ACTIONS)rows.push(await check(t,entry));
   data.push({accountId:t.accountId,
    roleArn:role(t),
    forbiddenWritesSimulated:ACTIONS.length,
    allWriteSimulationsDenied:true,
    decisionSetSha256:sha(rows)});
  }
  const time=clock();
  ok(Number.isSafeInteger(start)&&Number.isSafeInteger(time)&&
   time>=start&&time-start<=120000,
   'IAM denial checks stale or exceed bounded audit window');
  const proof={
   schemaVersion:1,commit,bundleSha256,
   iamEvidenceSha256:iamProof.evidenceSha256,
   boundaryEvidenceSha256:boundaryProof.evidenceSha256,
   source:data[0],offsite:data[1],
   totalForbiddenWriteActionsChecked:2*ACTIONS.length,
   allSimulatedWriteActionsDenied:true,
   checkedAtMs:time,expiresAtMs:time+60000,
   actualEffectiveIamRightsVerified:false,
   organizationSCPsAndKmsGrantsVerified:false,
   externalProviderIndependentlyAttested:false,
   productionAuthorized:false
  };
  return Object.freeze({...proof,evidenceSha256:sha(proof)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,enabled:allowNetwork,productionAuthorized:false})});
}
