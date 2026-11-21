/**
 * R168 AWS provider-readiness gate, no long-term credentials or deployment.
 * Checks AWS STS IAM assumed-role identity, S3 region/versioning/COMPLIANCE
 * lock/public-access blocks and exact enabled KMS symmetric key.
 *
 * Assumed-role identity is necessary but not sufficient to prove IAM policy;
 * no live AWS claim without a real OIDC-issued role and independent review.
 */
const ARN=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/([a-f0-9-]{36})$/;
const fail=m=>{throw Error('R168 AWS preflight: '+m);};
const check=(v,m)=>{if(!v)fail(m);};
export function createR168AwsPreflight({sts,s3,kms,commands,
 region,accountId,bucket,kmsKeyArn,
 assumedRole='marcosa-staging-backup-role',
 allowExternalCalls=false,clock=()=>Date.now()}={}){
 const m=typeof kmsKeyArn==='string'?ARN.exec(kmsKeyArn):null;
 check(m&&m[1]===region&&m[2]===accountId&&
  /^[0-9]{12}$/.test(accountId||'')&&
  typeof bucket==='string'&&/^[a-z0-9.-]{3,63}$/.test(bucket)&&
  /^marcosa-[a-z0-9-]{3,48}$/.test(assumedRole||''),
  'explicit AWS account, bucket, region, role and key ARN required');
 check(sts&&s3&&kms&&
  [sts,s3,kms].every(client=>typeof client.send==='function')&&
  commands&&[
   'GetCallerIdentityCommand','DescribeKeyCommand','GetBucketVersioningCommand',
   'GetObjectLockConfigurationCommand','GetPublicAccessBlockCommand',
   'GetBucketLocationCommand'
  ].every(name=>typeof commands[name]==='function')&&typeof clock==='function',
  'injected official SDK v3 clients and command constructors required');
 async function checkAdapter(client,Command,input){
  check(allowExternalCalls===true,'outbound preflight disabled');
  try{return await client.send(new Command(input),{abortSignal:AbortSignal.timeout(7000)});}
  catch{fail('provider availability or permissions denied');}
 }
 async function inspect(){
  check(allowExternalCalls===true,'outbound preflight disabled');
  const who=await checkAdapter(sts,commands.GetCallerIdentityCommand,{});
  const arn='arn:aws:sts::'+accountId+':assumed-role/'+assumedRole+'/';
  check(who?.Account===accountId&&typeof who.Arn==='string'&&
   who.Arn.startsWith(arn)&&
   /^[A-Za-z0-9+=,.@_-]{5,128}$/.test(who.Arn.slice(arn.length)),
   'expected temporary OIDC assumed-role identity not established');
  const key=await checkAdapter(kms,commands.DescribeKeyCommand,{KeyId:kmsKeyArn});
  const mk=key?.KeyMetadata;
  check(mk?.Arn===kmsKeyArn&&mk?.AWSAccountId===accountId&&
   mk.KeyState==='Enabled'&&mk.KeyUsage==='ENCRYPT_DECRYPT'&&
   mk.KeySpec==='SYMMETRIC_DEFAULT'&&mk.Enabled===true,
   'KMS key disabled, wrong account or not symmetric');
  const bucketInput={Bucket:bucket,ExpectedBucketOwner:accountId};
  const [location,versions,lock,block]=await Promise.all([
   checkAdapter(s3,commands.GetBucketLocationCommand,bucketInput),
   checkAdapter(s3,commands.GetBucketVersioningCommand,bucketInput),
   checkAdapter(s3,commands.GetObjectLockConfigurationCommand,bucketInput),
   checkAdapter(s3,commands.GetPublicAccessBlockCommand,bucketInput)
  ]);
  check(location?.LocationConstraint===region&&versions?.Status==='Enabled'&&
   lock?.ObjectLockConfiguration?.ObjectLockEnabled==='Enabled'&&
   lock.ObjectLockConfiguration.Rule?.DefaultRetention?.Mode==='COMPLIANCE'&&
   Number(lock.ObjectLockConfiguration.Rule.DefaultRetention.Days)>=7&&
   Number(lock.ObjectLockConfiguration.Rule.DefaultRetention.Days)<=3650,
   'S3 location, versioning or default COMPLIANCE lock not satisfied');
  const pb=block?.PublicAccessBlockConfiguration;
  check(pb&&['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy',
   'RestrictPublicBuckets'].every(k=>pb[k]===true),
   'S3 public-access block not fully enabled');
  const now=clock();
  check(Number.isSafeInteger(now)&&now>0,'trusted current time');
  return Object.freeze({passed:true,accountId,region,bucket,kmsKeyArn,
   assumedRole,identityArn:who.Arn,checkedAtMs:now,expiresAtMs:now+60000,
   objectLockCompliance:true,versioningEnabled:true,publicAccessBlocked:true,
   realAwsConnectionWasAttempted:true,independentPolicyAuditComplete:false,
   humanReviewVerified:false,productionAuthorized:false});
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  accountId,region,bucket,kmsKeyArn,assumedRole,
  networkOptIn:allowExternalCalls===true,productionAuthorized:false})});
}
export function verifyR168Readiness(lease,{accountId,region,bucket,kmsKeyArn,
 clock=()=>Date.now()}={}){
 const now=clock();
 check(lease&&Object.getPrototypeOf(lease)===Object.prototype&&
  lease.passed===true&&lease.accountId===accountId&&lease.region===region&&
  lease.bucket===bucket&&lease.kmsKeyArn===kmsKeyArn&&
  lease.objectLockCompliance===true&&lease.versioningEnabled===true&&
  lease.publicAccessBlocked===true&&
  lease.productionAuthorized===false&&
  Number.isSafeInteger(lease.checkedAtMs)&&
  Number.isSafeInteger(lease.expiresAtMs)&&
  now>=lease.checkedAtMs&&now<=lease.expiresAtMs&&
  lease.expiresAtMs-lease.checkedAtMs<=60000,
  'missing, stale or mis-scoped AWS readiness');
 return Object.freeze({allowedForSyntheticStaging:true,
  productionAuthorized:false,readyAtMs:lease.checkedAtMs});
}
