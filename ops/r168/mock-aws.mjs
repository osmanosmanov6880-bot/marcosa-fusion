/**
 * R168 strictly in-process simulated AWS v3 clients for *disposable CI only*.
 * Cryptographically protects the mock data key with a temporary AES-GCM CMK.
 * Not a real KMS, not S3, not an emulated IAM policy authority.
 */
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fakeKeyArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const AWS_COMMANDS=[
 'GenerateDataKeyCommand','DecryptCommand','DescribeKeyCommand',
 'GetCallerIdentityCommand','PutObjectCommand','HeadObjectCommand',
 'GetObjectCommand','GetBucketVersioningCommand',
 'GetObjectLockConfigurationCommand','GetPublicAccessBlockCommand',
 'GetBucketLocationCommand'
];
export const R168_SIMULATED_COMMANDS=Object.freeze(Object.fromEntries(
 AWS_COMMANDS.map(name=>[name,class{
  constructor(input){this.kind=name;this.input=input;}
 }])));
export function createR168SimulatedAws({clock=()=>Date.now()}={}){
 if(typeof clock!=='function')throw Error('R168 simulated AWS clock required');
 const cmk=randomBytes(32),objects=new Map(),calls=[],mutable={
  keyDisabled:false,publicAccess:false,governance:false,
  corruptBody:false,failDecrypt:false,wrongRole:false};
 let seq=0;
 async function send(cmd){
  if(!cmd||!AWS_COMMANDS.includes(cmd.kind))throw Error('Unrecognised mock SDK command');
  calls.push({kind:cmd.kind,input:cmd.input});
  const input=cmd.input||{};
  switch(cmd.kind){
  case 'GetCallerIdentityCommand':return{
   Account:'111122223333',
   Arn:mutable.wrongRole?
    'arn:aws:sts::111122223333:assumed-role/attacker/ci-r168':
    'arn:aws:sts::111122223333:assumed-role/marcosa-staging-backup-role/ci-r168'};
  case 'DescribeKeyCommand':return{KeyMetadata:{
   Arn:fakeKeyArn,AWSAccountId:'111122223333',
   Enabled:!mutable.keyDisabled,
   KeyState:mutable.keyDisabled?'Disabled':'Enabled',
   KeyUsage:'ENCRYPT_DECRYPT',KeySpec:'SYMMETRIC_DEFAULT'}};
  case 'GetBucketLocationCommand':return{LocationConstraint:'eu-west-1'};
  case 'GetBucketVersioningCommand':return{Status:'Enabled'};
  case 'GetObjectLockConfigurationCommand':return{
   ObjectLockConfiguration:{ObjectLockEnabled:'Enabled',
    Rule:{DefaultRetention:{Mode:mutable.governance?'GOVERNANCE':'COMPLIANCE',Days:7}}}};
  case 'GetPublicAccessBlockCommand':return{PublicAccessBlockConfiguration:{
   BlockPublicAcls:true,IgnorePublicAcls:true,
   BlockPublicPolicy:!mutable.publicAccess,RestrictPublicBuckets:true}};
  case 'GenerateDataKeyCommand':{
   if(input.KeyId!==fakeKeyArn||input.KeySpec!=='AES_256')throw Error('Fake KMS: KeyId');
   const dataKey=randomBytes(32),iv=randomBytes(12);
   const enc=createCipheriv('aes-256-gcm',cmk,iv);
   enc.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
   const bytes=Buffer.concat([enc.update(dataKey),enc.final()]);
   // Padding is mock-only, never reproduced by a real KMS client.
   return{KeyId:fakeKeyArn,Plaintext:dataKey,
    CiphertextBlob:Buffer.concat([iv,bytes,enc.getAuthTag(),Buffer.alloc(48)])};
  }
  case 'DecryptCommand':{
   if(input.KeyId!==fakeKeyArn||mutable.failDecrypt)throw Error('Fake KMS unavailable');
   const b=Buffer.from(input.CiphertextBlob);
   const dec=createDecipheriv('aes-256-gcm',cmk,b.subarray(0,12));
   dec.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
   dec.setAuthTag(b.subarray(44,60));
   return{KeyId:fakeKeyArn,
    Plaintext:Buffer.concat([dec.update(b.subarray(12,44)),dec.final()])};
  }
  case 'PutObjectCommand':{
   if(input.Bucket!=='marcosa-ci-locked'||input.ExpectedBucketOwner!=='111122223333'||
    input.IfNoneMatch!=='*'||input.ObjectLockMode!=='COMPLIANCE'||
    input.ServerSideEncryption!=='aws:kms'||input.SSEKMSKeyId!==fakeKeyArn)
    throw Error('Fake S3 immutable PutObject denied');
   if(objects.has(input.Key))throw Error('S3 PreconditionFailed 412');
   const buffer=Buffer.from(input.Body);
   const checksum=Buffer.from(sha(buffer),'hex').toString('base64');
   if(checksum!==input.ChecksumSHA256)throw Error('S3 BadDigest');
   const versionId='r168-ci-version-'+(++seq);
   objects.set(input.Key,{
    ...input,Body:buffer,ChecksumSHA256:checksum,VersionId:versionId
   });
   return{VersionId:versionId,ETag:'"not-a-content-hash"'};
  }
  case 'HeadObjectCommand':{
   const item=objects.get(input.Key);
   if(!item||item.VersionId!==input.VersionId)throw Error('S3 NotFound');
   return{VersionId:item.VersionId,ContentType:item.ContentType,
    ContentLength:item.ContentLength,ChecksumSHA256:item.ChecksumSHA256,
    ServerSideEncryption:item.ServerSideEncryption,SSEKMSKeyId:item.SSEKMSKeyId,
    ObjectLockMode:mutable.governance?'GOVERNANCE':item.ObjectLockMode,
    ObjectLockRetainUntilDate:item.ObjectLockRetainUntilDate,
    Metadata:item.Metadata};
  }
  case 'GetObjectCommand':{
   const item=objects.get(input.Key);
   if(!item||item.VersionId!==input.VersionId)throw Error('S3 NotFound');
   const body=Buffer.from(item.Body);
   if(mutable.corruptBody)body[body.length-25]^=1;
   return{VersionId:item.VersionId,ContentType:item.ContentType,
    ContentLength:item.ContentLength,ChecksumSHA256:item.ChecksumSHA256,
    Body:Readable.from([body])};
  }
  default:throw Error('unsupported simulated AWS operation');
  }
 }
 const client=Object.freeze({send});
 return Object.freeze({
  kmsClient:client,s3Client:client,stsClient:client,
  commands:R168_SIMULATED_COMMANDS,
  keyArn:fakeKeyArn,accountId:'111122223333',region:'eu-west-1',
  bucket:'marcosa-ci-locked',
  alter:changes=>{for(const [key,value] of Object.entries(changes)){
   if(!Object.hasOwn(mutable,key)||typeof value!=='boolean')
    throw Error('R168 mock: arbitrary privilege change denied');
   mutable[key]=value;
  }},
  metrics:()=>Object.freeze({objects:objects.size,
   commandTypes:calls.map(c=>c.kind),productionAuthorized:false,
   liveAws:false,temporaryMockKeyOnly:true}),
  dispose:()=>{cmk.fill(0);objects.clear();},
  productionAuthorized:false,realCloudProviderConnected:false
 });
}
