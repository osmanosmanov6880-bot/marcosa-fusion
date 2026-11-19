import test from 'node:test';
import assert from 'node:assert/strict';
import {assertR169IsolatedRunner,validateR169TemporaryCredentials,
 createR169AwsRuntime} from '../r169/aws-runtime.mjs';
const now=1800000000000,clock=()=>now;
const role='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
 GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
 GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'44532123456',
 MARCOSA_STAGING_ONLY:'true',MARCOSA_REAL_AWS_OPT_IN:'true',
 AWS_EC2_METADATA_DISABLED:'true'};
const cred=()=>({accessKeyId:'ASIA'+'A'.repeat(16),
 secretAccessKey:'B'.repeat(40),sessionToken:'temp-token-'+ 'x'.repeat(50),
 expiration:new Date(now+900000)});
function fakeModules(){
 const calls=[];
 class Base{constructor(options){this.options=options;calls.push(this);}destroy(){this.destroyed=true;}}
 const make=names=>Object.fromEntries(names.map(name=>[name,class{constructor(input){this.input=input;}}]));
 const kms={KMSClient:class extends Base{},...make(['GenerateDataKeyCommand','DecryptCommand',
  'DescribeKeyCommand'])};
 const s3={S3Client:class extends Base{},...make(['PutObjectCommand','HeadObjectCommand',
  'GetObjectCommand','GetBucketVersioningCommand','GetObjectLockConfigurationCommand',
  'GetPublicAccessBlockCommand','GetBucketLocationCommand'])};
 const sts={STSClient:class extends Base{},...make(['GetCallerIdentityCommand'])};
 return{modules:{kms,s3,sts},calls};
}
test('R169 only short-lived OIDC STS credentials, pinned repo/ref, no ambient endpoints',()=>{
 assert.equal(assertR169IsolatedRunner({env,clock}).checked,true);
 assert.equal(validateR169TemporaryCredentials({credentials:cred(),clock}).accessKeyId,'ASIA'+'A'.repeat(16));
 for(const change of [
  {GITHUB_REF:'refs/heads/main'},
  {GITHUB_EVENT_NAME:'pull_request'},
  {AWS_PROFILE:'default'},{AWS_ENDPOINT_URL:'https://evil.example'},
  {AWS_EC2_METADATA_DISABLED:'false'}
 ])assert.throws(()=>assertR169IsolatedRunner({env:{...env,...change},clock}),/R169 SDK bootstrap/);
 for(const data of [
  {...cred(),accessKeyId:'AKIA'+'A'.repeat(16)},
  {...cred(),expiration:new Date(now+24*3600000)},
  {...cred(),sessionToken:null},
  {...cred(),extra:true}
 ])assert.throws(()=>validateR169TemporaryCredentials({credentials:data,clock}),/R169 SDK bootstrap/);
});
test('R169 real SDK v3 constructor contract creates opted-in clients, no automatic AWS call',async()=>{
 const f=fakeModules(),runtime=await createR169AwsRuntime({
  modules:f.modules,credentials:cred(),env,clock,allowRealAws:true,
  accountId:'111122223333',region:'eu-west-1',bucket:'marcosa-ci-locked',
  kmsKeyArn:role
 });
 assert.equal(f.calls.length,3);
 assert.equal(f.calls[0].options.maxAttempts,1);
 assert.equal(f.calls[0].options.region,'eu-west-1');
 assert.equal(runtime.publicStatus().productionAuthorized,false);
 assert.equal(runtime.publicStatus().networkEnabled,true);
 const provided=await f.calls[0].options.credentials();
 assert.equal(provided.sessionToken,cred().sessionToken);
 await runtime.close();
 assert.ok(f.calls.every(c=>c.destroyed===true));
});
test('R169 default runtime never calls AWS without opt-in',async()=>{
 const f=fakeModules(),runtime=await createR169AwsRuntime({
  modules:f.modules,clock,
  accountId:'111122223333',region:'eu-west-1',bucket:'marcosa-ci-locked',
  kmsKeyArn:role
 });
 assert.equal(runtime.publicStatus().networkEnabled,false);
 await assert.rejects(runtime.kms.issue({}),/network disabled/);
 await runtime.close();
});
