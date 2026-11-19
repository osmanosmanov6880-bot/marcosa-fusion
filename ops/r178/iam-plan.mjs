/**
 * R178 deterministic least-privilege IAM blueprint for staging auditors.
 * Desired configuration only: never creates roles, attaches policies, issues
 * OIDC, calls IAM or asserts effective AWS permissions.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const H64=/^[a-f0-9]{64}$/,
 ARN=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):(\d{12}):key\/[a-f0-9-]{36}$/;
const fail=m=>{throw Error('R178 IAM plan: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const ROLE='marcosa-r178-readonly-auditor';
const SUB='repo:osmanosmanov6880-bot/marcosa-fusion:environment:marcosa-aws-staging';
function canon(x){
 if(Array.isArray(x))return x.map(canon);
 if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort()
  .map(k=>[k,canon(x[k])]));
 return x;
}
const json=x=>JSON.stringify(canon(x));
const sha=x=>createHash('sha256').update(json(x)).digest('hex');
const scope=x=>{
 const arn=ARN.exec(x?.kmsKeyArn||'');
 ok(x&&/^\d{12}$/.test(x.accountId||'')&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(x.bucket||'')&&
  arn&&arn[1]===x.region&&arn[2]===x.accountId,
  'exact source/offsite account, bucket and customer KMS ARN required');
 return{accountId:x.accountId,region:x.region,bucket:x.bucket,
  kmsKeyArn:x.kmsKeyArn};
};
function rolePolicy(s){
 const bucketArn='arn:aws:s3:::'+s.bucket;
 return{
  Version:'2012-10-17',
  Statement:[
   {Sid:'ExactBucketPostureReadOnly',Effect:'Allow',
    Action:['s3:GetBucketVersioning','s3:GetBucketObjectLockConfiguration',
     's3:GetBucketPublicAccessBlock'],
    Resource:bucketArn,
    Condition:{Bool:{'aws:SecureTransport':'true'}}},
   {Sid:'ExactVersionedCiphertextOnly',Effect:'Allow',
    Action:['s3:GetObject','s3:GetObjectVersion','s3:GetObjectRetention',
     's3:GetObjectVersionAttributes'],
    Resource:bucketArn+'/marcosa/isolated/r178/archive/*',
    Condition:{Bool:{'aws:SecureTransport':'true'}}},
   {Sid:'ExactKeyPostureOnly',Effect:'Allow',
    Action:['kms:DescribeKey','kms:GetKeyRotationStatus'],
    Resource:s.kmsKeyArn}
  ]
 };
}
function trust(s){
 return{Version:'2012-10-17',Statement:[{
  Sid:'OnlyApprovedGitHubStagingEnvironment',
  Effect:'Allow',
  Principal:{Federated:'arn:aws:iam::'+s.accountId+
   ':oidc-provider/token.actions.githubusercontent.com'},
  Action:'sts:AssumeRoleWithWebIdentity',
  Condition:{StringEquals:{
   'token.actions.githubusercontent.com:aud':'sts.amazonaws.com',
   'token.actions.githubusercontent.com:sub':SUB
  }}
 }]};
}
export function buildR178ReadOnlyIamBlueprint({source,offsite}={}){
 const a=scope(source),b=scope(offsite);
 ok(a.accountId!==b.accountId&&a.region!==b.region&&a.bucket!==b.bucket,
  'read-only plans must be independently scoped to two AWS accounts');
 const plans=[a,b].map(x=>({
  accountId:x.accountId,region:x.region,bucket:x.bucket,
  kmsKeyArn:x.kmsKeyArn,roleArn:'arn:aws:iam::'+x.accountId+':role/'+ROLE,
  trustPolicy:trust(x),permissionsPolicy:rolePolicy(x)
 }));
 const data={schemaVersion:1,scope:'read-only-isolated-staging-review',
  plans,productionAuthorized:false,policiesApplied:false,
  actualIamVerified:false};
 return Object.freeze({...data,planSha256:sha(data)});
}
export function verifyR178ReadOnlyIamBlueprint(plan,{source,offsite}={}){
 const expected=buildR178ReadOnlyIamBlueprint({source,offsite});
 const a=Buffer.from(json(plan||{})),b=Buffer.from(json(expected));
 ok(a.length===b.length&&timingSafeEqual(a,b)&&
  H64.test(plan?.planSha256||'')&&
  plan.productionAuthorized===false&&plan.policiesApplied===false&&
  plan.actualIamVerified===false,
  'desired IAM scope, OIDC trust or least-privilege actions modified');
 return Object.freeze({verified:true,planSha256:plan.planSha256,
  grantsMutationRights:false,effectiveIamRightsEstablished:false,
  productionAuthorized:false});
}
