/**
 * R169 read-only cloud configuration review for STAGING only.
 * Inspects KMS and S3 policy, default encryption and object ownership.
 * This is NOT a proof of effective IAM/SCP/network isolation.
 */
const ERR=m=>{throw Error('R169 cloud posture: '+m);};
const ok=(v,m)=>{if(!v)ERR(m);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exactArn=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):(\d{12}):key\/([a-f0-9-]{36})$/;
function parsePolicy(x,max=20000){
 ok(typeof x==='string'&&x.length>0&&x.length<max,
  'bounded JSON IAM policy required');
 let p;try{p=JSON.parse(x);}catch{ERR('malformed AWS policy');}
 ok(object(p)&&p.Version==='2012-10-17'&&Array.isArray(p.Statement)&&
  p.Statement.length>=1&&p.Statement.length<=30,
  'reviewed AWS JSON policy version and statement list required');
 for(const row of p.Statement)ok(object(row)&&
  ['Allow','Deny'].includes(row.Effect)&&
  row.Action!==undefined&&row.Resource!==undefined,
  'strict IAM policy statements required');
 return p;
}
const arr=x=>Array.isArray(x)?x:[x];
function hasPublicAllow(policy){
 return policy.Statement.some(p=>{
  if(p.Effect!=='Allow')return false;
  const people=p.Principal,items=typeof people==='string'?[people]:
   object(people)?Object.values(people).flatMap(arr):[];
  return items.includes('*')||items.some(x=>typeof x==='string'&&x.includes('?'));
 });
}
function checksForDenial(policy){
 return policy.Statement.some(x=>x.Effect==='Deny'&&
  arr(x.Action).includes('s3:*')&&
  x.Principal==='*'&&
  x.Condition?.Bool?.['aws:SecureTransport']==='false');
}
function keyRules(policy,accountId,kmsKeyArn,roleArn){
 ok(!hasPublicAllow(policy),'public KMS policy principal allowed');
 const owners=policy.Statement.filter(x=>x.Effect==='Allow');
 ok(owners.every(x=>{
  const a=arr(x.Principal?.AWS);
  return a.every(value=>value===roleArn||
   value==='arn:aws:iam::'+accountId+':root');
 }),'KMS key policy trust extends outside reviewed AWS role or account root');
 ok(owners.some(x=>arr(x.Principal?.AWS).includes(roleArn)&&
  arr(x.Action).includes('kms:Decrypt')&&
  arr(x.Action).includes('kms:GenerateDataKey')&&
  (x.Resource==='*'||x.Resource===kmsKeyArn)&&
  x.Condition?.StringEquals?.['kms:EncryptionContext:marcosa-scope']===
   'isolated-staging-only'),
  'KMS staging role lacks an exact encryption-context grant');
}
export function createR169CloudPosture({
 s3,kms,commands,accountId,region,bucket,kmsKeyArn,
 assumedRoleArn,allowExternalCalls=false,clock=()=>Date.now()
}={}){
 const match=typeof kmsKeyArn==='string'?exactArn.exec(kmsKeyArn):null;
 ok(match&&match[1]===region&&match[2]===accountId&&
  typeof bucket==='string'&&/^[a-z0-9.-]{3,63}$/.test(bucket)&&
  assumedRoleArn==='arn:aws:iam::'+accountId+
   ':role/marcosa-staging-backup-role',
  'exact staging scope and role required');
 ok(s3&&kms&&typeof s3.send==='function'&&
  typeof kms.send==='function'&&commands&&
  ['GetBucketPolicyCommand','GetBucketEncryptionCommand',
   'GetBucketOwnershipControlsCommand','GetKeyPolicyCommand']
   .every(k=>typeof commands[k]==='function')&&typeof clock==='function',
  'official AWS SDK clients and read-only commands required');
 const issue=async(client,command,input)=>{
  ok(allowExternalCalls===true,'external cloud access disabled');
  try{return await client.send(new command(input),{
   abortSignal:AbortSignal.timeout(6500)
  });}catch{ERR('read-only posture query failed');}
 };
 async function inspect(){
  ok(allowExternalCalls===true,'external cloud access disabled');
  const [bp,be,bo,kp]=await Promise.all([
   issue(s3,commands.GetBucketPolicyCommand,{
    Bucket:bucket,ExpectedBucketOwner:accountId}),
   issue(s3,commands.GetBucketEncryptionCommand,{
    Bucket:bucket,ExpectedBucketOwner:accountId}),
   issue(s3,commands.GetBucketOwnershipControlsCommand,{
    Bucket:bucket,ExpectedBucketOwner:accountId}),
   issue(kms,commands.GetKeyPolicyCommand,{KeyId:kmsKeyArn,PolicyName:'default'})
  ]);
  const bucketPolicy=parsePolicy(bp?.Policy);
  const keyPolicy=parsePolicy(kp?.Policy);
  ok(!hasPublicAllow(bucketPolicy)&&checksForDenial(bucketPolicy),
   'bucket policy must explicitly deny insecure TLS and public grants');
  const rule=be?.ServerSideEncryptionConfiguration?.Rules;
  ok(Array.isArray(rule)&&rule.length===1&&
   rule[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm==='aws:kms'&&
   rule[0]?.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID===kmsKeyArn,
   'bucket default encryption must use exact customer KMS key');
  const owners=bo?.OwnershipControls?.Rules;
  ok(Array.isArray(owners)&&owners.length===1&&
   owners[0]?.ObjectOwnership==='BucketOwnerEnforced',
   'S3 ACLs must be disabled by bucket owner enforced');
  keyRules(keyPolicy,accountId,kmsKeyArn,assumedRoleArn);
  const time=clock();
  ok(Number.isSafeInteger(time)&&time>0,'timestamp required');
  return Object.freeze({
   inspected:true,accountId,region,bucket,kmsKeyArn,
   checkedAtMs:time,expiresAtMs:time+60000,
   bucketTlsDenyObserved:true,bucketNoPublicAllowObserved:true,
   defaultSseKmsVerified:true,ownerEnforcedVerified:true,
   kmsContextPolicyObserved:true,
   effectiveScpPermissionsAudited:false,
   realCloudTenantVerified:false,productionAuthorized:false
  });
 }
 return Object.freeze({inspect});
}
export function verifyR169CloudPosture(lease,{accountId,region,bucket,
 kmsKeyArn,clock=()=>Date.now()}={}){
 const now=clock();
 ok(lease&&lease.inspected===true&&lease.accountId===accountId&&
  lease.region===region&&lease.bucket===bucket&&
  lease.kmsKeyArn===kmsKeyArn&&
  Number.isSafeInteger(now)&&
  now>=lease.checkedAtMs&&now<=lease.expiresAtMs&&
  lease.expiresAtMs-lease.checkedAtMs<=60000&&
  lease.bucketTlsDenyObserved===true&&
  lease.bucketNoPublicAllowObserved===true&&
  lease.defaultSseKmsVerified===true&&
  lease.ownerEnforcedVerified===true&&
  lease.kmsContextPolicyObserved===true&&
  lease.productionAuthorized===false,
  'configuration changed, missing or expired; operator stage blocked');
 return Object.freeze({passed:true,isolatedDrillOnly:true,
  noProductionAuthorization:true});
}
