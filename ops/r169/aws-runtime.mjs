/**
 * R169 actual AWS SDK v3 client bootstrap with explicit short-lived OIDC
 * credentials. Disabled by default; no AWS calls performed by construction.
 *
 * Packages are expected in this directory from the exact-version package
 * manifest. Production credentials and role assumption are NEVER created here.
 */
import {createR168AwsKmsAdapter} from '../r168/aws-kms.mjs';
import {createR168AwsS3Adapter} from '../r168/aws-s3.mjs';
import {createR168AwsPreflight} from '../r168/aws-preflight.mjs';

const ACCOUNT=/^\d{12}$/,ARN=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):(\d{12}):key\/([a-f0-9-]{36})$/;
const ROLE=/^[a-zA-Z0-9+=,.@_-]{6,60}$/;
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const REF='refs/heads/feature/marcosa-r150-growth-economics';
const ERROR=m=>{throw Error('R169 SDK bootstrap: '+m);};
const assert=(yes,m)=>{if(!yes)ERROR(m);};

export function assertR169IsolatedRunner({env=process.env,clock=()=>Date.now()}={}){
 assert(env&&typeof env==='object'&&
  env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPO&&
  env.GITHUB_REF===REF&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&
  env.MARCOSA_STAGING_ONLY==='true'&&
  env.MARCOSA_REAL_AWS_OPT_IN==='true'&&
  env.AWS_EC2_METADATA_DISABLED==='true'&&
  typeof env.GITHUB_RUN_ID==='string'&&/^[0-9]{5,20}$/.test(env.GITHUB_RUN_ID),
  'explicit GitHub manual staging job and IMDS disabled required');
 const forbidden=['AWS_PROFILE','AWS_SHARED_CREDENTIALS_FILE','AWS_CONFIG_FILE',
  'AWS_ENDPOINT_URL','AWS_ENDPOINT_URL_S3','AWS_ENDPOINT_URL_KMS','AWS_ENDPOINT_URL_STS',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI','AWS_CONTAINER_CREDENTIALS_FULL_URI'];
 assert(forbidden.every(k=>!env[k]),'credential chain or endpoint override not permitted');
 assert(typeof clock==='function'&&Number.isSafeInteger(clock()),
  'trusted execution clock required');
 return Object.freeze({checked:true,repository:REPO,ref:REF,
  credentialSource:'caller-injected-temporary-oidc',productionAuthorized:false,
  OidcTrustActuallyVerified:false});
}
export function validateR169TemporaryCredentials({credentials,clock=()=>Date.now()}={}){
 assert(credentials&&Object.getPrototypeOf(credentials)===Object.prototype,
  'AWS temporary credentials object required');
 assert(Object.keys(credentials).sort().join(',')===
  'accessKeyId,expiration,secretAccessKey,sessionToken',
  'exact temporary credential contract required');
 assert(typeof credentials.accessKeyId==='string'&&
  /^ASIA[A-Z0-9]{16}$/.test(credentials.accessKeyId)&&
  typeof credentials.secretAccessKey==='string'&&
  /^[A-Za-z0-9/+=]{40}$/.test(credentials.secretAccessKey)&&
  typeof credentials.sessionToken==='string'&&credentials.sessionToken.length>=20&&
  credentials.sessionToken.length<=10000&&
  credentials.expiration instanceof Date,
  'only temporary STS session credentials with expiration permitted');
 const expires=credentials.expiration.getTime(),now=clock();
 assert(Number.isSafeInteger(now)&&Number.isFinite(expires)&&
  expires>now+120000&&expires<=now+3600000,
  'STS credentials expire too soon or are unexpectedly long-lived');
 // Explicit provider avoids ambient default credential chain / instance roles.
 return Object.freeze({accessKeyId:credentials.accessKeyId,
  secretAccessKey:credentials.secretAccessKey,
  sessionToken:credentials.sessionToken,expiration:credentials.expiration});
}
export async function loadR169OfficialSdkModules(){
 try{
  const [kms,s3,sts]=await Promise.all([
   import('@aws-sdk/client-kms'),import('@aws-sdk/client-s3'),
   import('@aws-sdk/client-sts')
  ]);
  return Object.freeze({kms,s3,sts});
 }catch{
  ERROR('install exact-version AWS SDK v3 dependencies before live bootstrap');
 }
}
export async function createR169AwsRuntime({
 modules,credentials,env=process.env,accountId,region,bucket,kmsKeyArn,
 assumedRole='marcosa-staging-backup-role',clock=()=>Date.now(),
 allowRealAws=false
}={}){
 const runner=allowRealAws?
  assertR169IsolatedRunner({env,clock}):
  Object.freeze({checked:false,productionAuthorized:false});
 assert(ACCOUNT.test(accountId||'')&&typeof kmsKeyArn==='string'&&
  ARN.test(kmsKeyArn)&&ARN.exec(kmsKeyArn)[1]===region&&
  ARN.exec(kmsKeyArn)[2]===accountId&&ROLE.test(assumedRole),
  'exact account, region, role and KMS ARN required');
 const credentialProvider=credentials?
  async()=>validateR169TemporaryCredentials({credentials,clock}):
  async()=>ERROR('caller must supply temporary STS credentials');
 if(allowRealAws)await credentialProvider();
 const loaded=modules||await loadR169OfficialSdkModules();
 assert(loaded&&loaded.kms&&loaded.s3&&loaded.sts&&
  ['KMSClient','GenerateDataKeyCommand','DecryptCommand','DescribeKeyCommand']
   .every(k=>typeof loaded.kms[k]==='function')&&
  ['S3Client','PutObjectCommand','HeadObjectCommand','GetObjectCommand',
   'GetBucketLocationCommand','GetBucketVersioningCommand',
   'GetObjectLockConfigurationCommand','GetPublicAccessBlockCommand']
   .every(k=>typeof loaded.s3[k]==='function')&&
  ['STSClient','GetCallerIdentityCommand'].every(k=>typeof loaded.sts[k]==='function'),
  'actual SDK v3 KMS/S3/STS modules and commands required');
 // Never pass endpoint or HTTP mocks into live clients. DNS and TLS must use
 // AWS endpoint discovery, and retries are disabled on ambiguous writes.
 const options={region,credentials:credentialProvider,maxAttempts:1,
  retryMode:'standard',useFipsEndpoint:false,useDualstackEndpoint:false};
 const clients={
  kms:new loaded.kms.KMSClient(options),
  s3:new loaded.s3.S3Client({...options,forcePathStyle:false}),
  sts:new loaded.sts.STSClient(options)
 };
 const commands={
  GenerateDataKeyCommand:loaded.kms.GenerateDataKeyCommand,
  DecryptCommand:loaded.kms.DecryptCommand,
  DescribeKeyCommand:loaded.kms.DescribeKeyCommand,
  GetCallerIdentityCommand:loaded.sts.GetCallerIdentityCommand,
  PutObjectCommand:loaded.s3.PutObjectCommand,
  HeadObjectCommand:loaded.s3.HeadObjectCommand,
  GetObjectCommand:loaded.s3.GetObjectCommand,
  GetBucketVersioningCommand:loaded.s3.GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand:loaded.s3.GetObjectLockConfigurationCommand,
  GetPublicAccessBlockCommand:loaded.s3.GetPublicAccessBlockCommand,
  GetBucketLocationCommand:loaded.s3.GetBucketLocationCommand
 };
 const base={accountId,region,clock,allowExternalCalls:allowRealAws};
 const kms=createR168AwsKmsAdapter({
  ...base,client:clients.kms,commands,keyArn:kmsKeyArn
 });
 const s3=createR168AwsS3Adapter({
  ...base,client:clients.s3,commands,kmsKeyArn,bucket
 });
 const preflight=createR168AwsPreflight({
  ...base,sts:clients.sts,kms:clients.kms,s3:clients.s3,
  commands,kmsKeyArn,bucket,assumedRole
 });
 let disposed=false;
 async function close(){
  if(disposed)return;
  disposed=true;
  for(const client of Object.values(clients))client.destroy?.();
 }
 return Object.freeze({clients,kms,s3,preflight,close,
  publicStatus:()=>Object.freeze({
   configured:true,networkEnabled:allowRealAws,
   pinnedAccount:accountId,pinnedRegion:region,pinnedKmsKeyArn:kmsKeyArn,
   runnerVerified:runner.checked,
   oidcTrustPolicyIndependentlyAudited:false,
   productionAuthorized:false
  })});
}
