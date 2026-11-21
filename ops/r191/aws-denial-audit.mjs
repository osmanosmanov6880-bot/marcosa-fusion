/** Actual IAM simulate-principal-policy, read-only STS caller boundary on
 * independently pinned source/offsite profiles. Simulation is NOT effective
 * IAM/SCP/KMS resource authorization and NEVER permits deployment. */
import {H40,H64,plain,requireTrue,sealReceipt} from '../r190/common.mjs';
const groups=[
 {name:'s3',actions:['s3:PutObject','s3:DeleteObject','s3:DeleteBucket',
  's3:PutBucketPolicy','s3:PutBucketReplication','s3:PutBucketVersioning']},
 {name:'kms',actions:['kms:DisableKey','kms:ScheduleKeyDeletion','kms:PutKeyPolicy']},
 {name:'iam',actions:['iam:PassRole','iam:PutRolePolicy','iam:AttachRolePolicy']}
];
const ACCOUNT=/^[0-9]{12}$/,ROLE='marcosa-r178-readonly-auditor';
function scope(x){
 requireTrue(plain(x)&&ACCOUNT.test(x.accountId||'')&&
  typeof x.profile==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x.profile)&&
  /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(x.region||'')&&
  x.roleArn==='arn:aws:iam::'+x.accountId+':role/'+ROLE&&
  typeof x.kmsKeyArn==='string'&&
  x.kmsKeyArn.startsWith('arn:aws:kms:'+x.region+':'+x.accountId+':key/')&&
  typeof x.s3ObjectArn==='string'&&
  /^arn:aws:s3:::[a-z0-9.-]{3,63}\/[a-zA-Z0-9/_.-]{1,120}$/.test(x.s3ObjectArn),
  'explicit pinned IAM role, KMS and S3 object scope required');
}
export async function inspectR191AwsDenials({
 commit,bundleSha256,source,offsite,executeAws,
 allowNetwork=false,sourceMode='CI_FIXTURE',clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof executeAws==='function'&&typeof clock==='function'&&
  ['CI_FIXTURE','OPERATOR_READONLY_UNATTESTED'].includes(sourceMode)&&
  allowNetwork===true,'only explicit read-only AWS simulation permitted');
 scope(source);scope(offsite);
 requireTrue(source.accountId!==offsite.accountId&&
  source.profile!==offsite.profile,'two separate pinned AWS accounts required');
 const started=clock();
 async function run(account,service,operation,params){
  let result;
  try{result=await executeAws({profile:account.profile,
    region:account.region,service,operation,params});}
  catch{throw Error('R191: AWS read-only operation failed');}
  requireTrue(plain(result?.json),'AWS returned invalid JSON');
  return result.json;
 }
 async function inspect(account){
  const caller=await run(account,'sts','get-caller-identity',{});
  requireTrue(caller.Account===account.accountId&&
   typeof caller.Arn==='string'&&
   caller.Arn.startsWith('arn:aws:sts::'+account.accountId+
   ':assumed-role/'+ROLE+'/'),
   'AWS session does not match operator-pinned read-only role');
  const results=[];
  for(const group of groups){
   const resource=group.name==='s3'?account.s3ObjectArn:
    group.name==='kms'?account.kmsKeyArn:account.roleArn;
   const result=await run(account,'iam','simulate-principal-policy',{
    PolicySourceArn:account.roleArn,
    ActionNames:group.actions,
    ResourceArns:[resource]
   });
   requireTrue(result.IsTruncated===false&&
    Array.isArray(result.EvaluationResults)&&
    result.EvaluationResults.length===group.actions.length,
    'incomplete AWS IAM decision simulation');
   const seen=new Set();
   for(const entry of result.EvaluationResults){
    requireTrue(group.actions.includes(entry?.EvalActionName)&&
     !seen.has(entry.EvalActionName)&&
     ['allowed','explicitDeny','implicitDeny'].includes(entry.EvalDecision),
     'IAM omitted, duplicated or unknown action result');
    seen.add(entry.EvalActionName);
    results.push({action:entry.EvalActionName,
     denied:entry.EvalDecision!=='allowed'});
   }
   requireTrue(seen.size===group.actions.length,'IAM simulation incomplete');
  }
  return {accountId:account.accountId,
   operationsSimulated:results.length,
   destructiveActionsDenied:results.filter(r=>r.denied).length,
   unexpectedAllows:results.filter(r=>!r.denied).map(r=>r.action)};
 }
 const [a,b]=await Promise.all([inspect(source),inspect(offsite)]);
 const finished=clock();
 requireTrue(Number.isSafeInteger(started)&&Number.isSafeInteger(finished)&&
  finished>=started&&finished-started<=60000,
  'AWS inspection is stale or exceeded bounded window');
 return sealReceipt({schemaVersion:1,kind:'R191_AWS',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,sourceMode,
  source:a,offsite:b,all24DangerousActionsDenied:
   a.destructiveActionsDenied===12&&b.destructiveActionsDenied===12,
  stsSessionAccountAndRoleShapeChecked:true,
  organizationsScpIndependentlyVerified:false,
  kmsKeyPolicyAndEffectiveRightsVerified:false,
  realPermissionsProvenBySimulation:false,
  observedAtMs:finished,expiresAtMs:finished+60000,
  decision:'NO_GO_LIVE_AWS_EFFECTIVE_RIGHTS_NOT_ATTESTED',
  realPilotAuthorized:false,productionAuthorized:false});
}
