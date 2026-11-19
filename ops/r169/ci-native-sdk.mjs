/**
 * R169 verifies REAL published @aws-sdk/client-{kms,s3,sts} v3 command
 * classes installed at exact top-level versions, without ANY AWS request.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadR169OfficialSdkModules,createR169AwsRuntime} from './aws-runtime.mjs';
const fail=m=>{throw Error('R169 real SDK smoke: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
ok(process.env.GITHUB_ACTIONS==='true'&&
 process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 !process.env.AWS_ACCESS_KEY_ID&&!process.env.AWS_SECRET_ACCESS_KEY&&
 !process.env.AWS_SESSION_TOKEN,
 'no actual AWS credentials permitted in SDK smoke runner');
for(const name of ['kms','s3','sts']){
 const p=join(process.cwd(),'ops/r169/node_modules/@aws-sdk/client-'+name+'/package.json');
 const pkg=JSON.parse(await readFile(p,'utf8'));
 ok(pkg.version==='3.1170.0','AWS SDK pinned top-level version drift: '+name);
}
const loaded=await loadR169OfficialSdkModules();
const runtime=await createR169AwsRuntime({
 modules:loaded,allowRealAws:false,
 accountId:'111122223333',region:'eu-west-1',bucket:'marcosa-ci-locked',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'
});
try{
 ok(runtime.clients.kms?.constructor?.name==='KMSClient'&&
  runtime.clients.s3?.constructor?.name==='S3Client'&&
  runtime.clients.sts?.constructor?.name==='STSClient'&&
  runtime.publicStatus().networkEnabled===false&&
  runtime.publicStatus().productionAuthorized===false,
  'native official AWS SDK constructors unavailable');
 const kmsCmd=new loaded.kms.GenerateDataKeyCommand({
  KeyId:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
  KeySpec:'AES_256',EncryptionContext:{'marcosa-scope':'isolated-staging-only'}
 });
 const s3Cmd=new loaded.s3.PutObjectCommand({
  Bucket:'marcosa-ci-locked',Key:'marcosa/isolated/r168/fake.r165enc',
  IfNoneMatch:'*',ObjectLockMode:'COMPLIANCE',
  ServerSideEncryption:'aws:kms',ExpectedBucketOwner:'111122223333'
 });
 ok(kmsCmd.constructor.name==='GenerateDataKeyCommand'&&
  s3Cmd.constructor.name==='PutObjectCommand'&&
  s3Cmd.input.IfNoneMatch==='*'&&s3Cmd.input.ObjectLockMode==='COMPLIANCE',
  'actual SDK v3 command serializer input unavailable');
 console.log('R169_NATIVE_PINNED_AWS_SDK_V3_KMS_S3_STS_IMPORTED=PASS');
 console.log('R169_NATIVE_AWS_SDK_COMMANDS_NO_NETWORK=PASS');
 console.log('R169_REAL_AWS_CREDENTIALS_AND_SERVICE_CONNECTIONS=NO_GO');
}finally{await runtime.close();}
