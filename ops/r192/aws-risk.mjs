/** R192 segregates read-only IAM simulation from real cloud authorization. */
import {H40,H64,plain,requireTrue,verifyReceipt,sealReceipt} from '../r190/common.mjs';
export function assessR192AwsRisk({commit,bundleSha256,iam,clock=()=>Date.now()}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof clock==='function','source-pinned AWS decision required');
 const a=verifyReceipt(iam,'R191_AWS',commit,bundleSha256);
 const t=clock();
 requireTrue(Number.isSafeInteger(t)&&t>=a.observedAtMs&&t<=a.expiresAtMs,
  'AWS IAM simulation expired or future');
 requireTrue(['CI_FIXTURE','OPERATOR_READONLY_UNATTESTED'].includes(a.sourceMode)&&
  plain(a.source)&&plain(a.offsite)&&a.stsSessionAccountAndRoleShapeChecked===true&&
  a.source.accountId!==a.offsite.accountId,'two distinct source/offsite STS accounts required');
 const reasons=[];
 const countries=[a.source,a.offsite];
 for(let i=0;i<countries.length;i++){
  const x=countries[i];
  requireTrue(/^[0-9]{12}$/.test(x.accountId||'')&&
   Number.isSafeInteger(x.operationsSimulated)&&x.operationsSimulated===12&&
   Number.isSafeInteger(x.destructiveActionsDenied)&&
   x.destructiveActionsDenied>=0&&x.destructiveActionsDenied<=12&&
   Array.isArray(x.unexpectedAllows)&&
   x.unexpectedAllows.length===12-x.destructiveActionsDenied,
   'incomplete or contradictory IAM simulation results');
  if(x.unexpectedAllows.length)reasons.push(
   (i===0?'SOURCE':'OFFSITE')+'_DESTRUCTIVE_IAM_ACTION_NOT_DENIED');
 }
 requireTrue(a.realPermissionsProvenBySimulation===false&&
  a.kmsKeyPolicyAndEffectiveRightsVerified===false&&
  a.organizationsScpIndependentlyVerified===false,
  'IAM simulator must not claim effective live permissions');
 const allDenied=countries.every(x=>x.destructiveActionsDenied===12);
 requireTrue(a.all24DangerousActionsDenied===allDenied,
  'AWS summary disagrees with actual 24 simulated decisions');
 reasons.push('AWS_SCP_KMS_RESOURCE_POLICY_NOT_EXTERNALLY_ATTESTED');
 return sealReceipt({schemaVersion:1,kind:'R192_IAM_RISK',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  iamEvidenceSha256:a.evidenceSha256,
  sourceMode:a.sourceMode,simulatedActions:24,
  simulatedDenied:a.source.destructiveActionsDenied+a.offsite.destructiveActionsDenied,
  dangerousActionSimulationAllDenied:allDenied,
  awsEffectiveRightsIndependentlyVerified:false,
  blockers:reasons,observedAtMs:t,expiresAtMs:a.expiresAtMs,
  decision:'NO_GO_EFFECTIVE_IAM_SCP_KMS_NOT_PROVEN',
  realPilotAuthorized:false,productionAuthorized:false});
}
