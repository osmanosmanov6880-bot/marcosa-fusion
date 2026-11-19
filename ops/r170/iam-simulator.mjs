/**
 * R170 read-only AWS IAM SimulatePrincipalPolicy canaries.
 * Important AWS limit: the API cannot simulate resource-based policies for
 * IAM roles and is not an actual service authorization test. This result
 * must NOT be described as full effective IAM/SCP access or production grant.
 * Requires a separately approved auditor SDK client.
 */
const ACCOUNT=/^[0-9]{12}$/,H64=/^[a-f0-9]{64}$/;
const ARN=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/([a-f0-9-]{36})$/;
const fail=m=>{throw Error('R170 IAM simulation: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const bucketResource=b=>'arn:aws:s3:::'+b;
const objectResource=(b,path)=>bucketResource(b)+'/'+path;
function context(scope='isolated-staging-only'){
 return [
  {ContextKeyName:'kms:EncryptionContext:marcosa-project',
   ContextKeyValues:['marcosa-fusion'],ContextKeyType:'string'},
  {ContextKeyName:'kms:EncryptionContext:marcosa-scope',
   ContextKeyValues:[scope],ContextKeyType:'string'},
  {ContextKeyName:'kms:EncryptionContext:marcosa-version',
   ContextKeyValues:['r168'],ContextKeyType:'string'}
 ];
}
export function r170IamCanaries({accountId,bucket,kmsKeyArn,
 roleName='marcosa-staging-backup-role',archiveSha256}={}){
 const match=typeof kmsKeyArn==='string'?ARN.exec(kmsKeyArn):null;
 ok(ACCOUNT.test(accountId||'')&&match&&match[2]===accountId&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(bucket||'')&&
  roleName==='marcosa-staging-backup-role'&&H64.test(archiveSha256||''),
  'exact isolated cloud resources and archive digest required');
 const obj=objectResource(bucket,'marcosa/isolated/r168/'+archiveSha256+'.r165enc');
 const bkt=bucketResource(bucket);
 const role='arn:aws:iam::'+accountId+':role/'+roleName;
 const positives=[
  {name:'kms-issue',action:'kms:GenerateDataKey',resource:kmsKeyArn,ctx:context()},
  {name:'kms-decrypt',action:'kms:Decrypt',resource:kmsKeyArn,ctx:context()},
  {name:'s3-create-locked',action:'s3:PutObject',resource:obj},
  {name:'s3-version-read',action:'s3:GetObjectVersion',resource:obj},
  {name:'s3-object-attributes',action:'s3:GetObjectVersionAttributes',resource:obj},
  {name:'s3-retention',action:'s3:GetObjectRetention',resource:obj},
  {name:'s3-bucket-versioning',action:'s3:GetBucketVersioning',resource:bkt}
 ];
 const negatives=[
  {name:'deny-delete-version',action:'s3:DeleteObjectVersion',resource:obj},
  {name:'deny-bypass-lock',action:'s3:BypassGovernanceRetention',resource:obj},
  {name:'deny-policy-edit',action:'s3:PutBucketPolicy',resource:bkt},
  {name:'deny-kms-deletion',action:'kms:ScheduleKeyDeletion',resource:kmsKeyArn},
  {name:'deny-production-prefix',action:'s3:PutObject',
   resource:objectResource(bucket,'marcosa/production/'+archiveSha256+'.r165enc')},
  {name:'deny-wrong-kms-context',action:'kms:Decrypt',resource:kmsKeyArn,
   ctx:context('production')}
 ];
 return Object.freeze({role,positives,negatives,total:positives.length+negatives.length,
  productionAuthorized:false});
}
function resultMatches(x,item,expectAllowed){
 ok(x&&x.EvalActionName===item.action&&
  x.EvalResourceName===item.resource&&
  Array.isArray(x.MissingContextValues)&&x.MissingContextValues.length===0&&
  Array.isArray(x.ResourceSpecificResults)&&x.ResourceSpecificResults.length===1&&
  x.ResourceSpecificResults[0].EvalResourceName===item.resource&&
  x.ResourceSpecificResults[0].EvalResourceDecision===x.EvalDecision,
  'AWS simulator did not return one exact complete action/resource result');
 const decision=x.EvalDecision;
 ok(decision===(expectAllowed?'allowed':'explicitDeny')||
  (!expectAllowed&&decision==='implicitDeny'),
  'unexpected IAM permission decision');
 if(expectAllowed){
  ok(x.PermissionsBoundaryDecisionDetail?.AllowedByPermissionsBoundary!==false&&
   x.OrganizationsDecisionDetail?.AllowedByOrganizations!==false,
   'SCP or permissions boundary explicitly declined');
 }
 return decision;
}
export function createR170IamSimulator({
 client,commands,accountId,bucket,kmsKeyArn,archiveSha256,
 allowExternalCalls=false,clock=()=>Date.now()
}={}){
 const spec=r170IamCanaries({accountId,bucket,kmsKeyArn,archiveSha256});
 ok(client&&typeof client.send==='function'&&
  commands&&typeof commands.SimulatePrincipalPolicyCommand==='function'&&
  typeof clock==='function','injected IAM SDK v3 simulator required');
 async function inspect(){
  ok(allowExternalCalls===true,'IAM simulation network disabled');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted bounded timestamp required');
  const decisions=[];
  for(const [expectedAllow,tests] of [[true,spec.positives],[false,spec.negatives]]){
   for(const item of tests){
    let output;
    try{
     output=await client.send(new commands.SimulatePrincipalPolicyCommand({
      PolicySourceArn:spec.role,ActionNames:[item.action],
      ResourceArns:[item.resource],
      ...(item.ctx?{ContextEntries:item.ctx}:{}),MaxItems:10
     }),{abortSignal:AbortSignal.timeout(7500)});
    }catch{fail('IAM simulation request denied or unavailable');}
    ok(output?.IsTruncated===false&&
     Array.isArray(output.EvaluationResults)&&output.EvaluationResults.length===1,
     'pagination or partial IAM simulator evidence refused');
    const decision=resultMatches(output.EvaluationResults[0],item,expectedAllow);
    decisions.push({name:item.name,decision,expectedAllow});
   }
  }
  ok(decisions.length===spec.total,'incomplete IAM canary coverage');
  return Object.freeze({checked:true,roleArn:spec.role,accountId,bucket,
   kmsKeyArn,archiveSha256,checks:decisions.length,
   allowed:decisions.filter(x=>x.expectedAllow).length,
   denied:decisions.filter(x=>!x.expectedAllow).length,
   checkedAtMs:now,expiresAtMs:now+60000,
   roleResourcePolicySimulated:false,
   effectiveServiceAuthorizationEstablished:false,
   independentCloudAuditorIdentityVerified:false,
   productionAuthorized:false});
 }
 return Object.freeze({inspect,canaryCount:spec.total});
}
export function verifyR170IamSimulation(proof,{accountId,bucket,kmsKeyArn,
 archiveSha256,clock=()=>Date.now()}={}){
 const spec=r170IamCanaries({accountId,bucket,kmsKeyArn,archiveSha256});
 const now=clock();
 ok(proof&&proof.checked===true&&proof.roleArn===spec.role&&
  proof.accountId===accountId&&proof.bucket===bucket&&
  proof.kmsKeyArn===kmsKeyArn&&proof.archiveSha256===archiveSha256&&
  proof.checks===spec.total&&proof.allowed===spec.positives.length&&
  proof.denied===spec.negatives.length&&
  Number.isSafeInteger(now)&&now>=proof.checkedAtMs&&
  now<=proof.expiresAtMs&&proof.expiresAtMs-proof.checkedAtMs<=60000&&
  proof.roleResourcePolicySimulated===false&&
  proof.effectiveServiceAuthorizationEstablished===false&&
  proof.productionAuthorized===false,
  'IAM simulator canary proof stale, partial or incorrectly elevated');
 return Object.freeze({canaryChecksVerified:true,
  effectiveAuthorizationStillUnknown:true,productionAuthorized:false});
}
