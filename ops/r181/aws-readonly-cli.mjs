/**
 * R181 read-only REAL AWS CLI adapter with separate profiles.
 * Non-shell spawn; exact allowlisted STS/S3 GET operations only; GET object
 * writes to private temporary path, SHA-256 checked, then deleted.
 * AWS SSE-KMS GET returns the object's application-level AES-GCM bytes
 * (S3 decrypts its storage layer); not physical SSE-KMS ciphertext.
 * CI injects executor; no live AWS call and no provider authenticity claim.
 */
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 PROFILE=/^[A-Za-z0-9_-]{1,64}$/,
 VERSION=/^[A-Za-z0-9_.-]{1,128}$/,
 ACCOUNT=/^[0-9]{12}$/,
 KMS=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/[a-f0-9-]{36}$/;
const fail=m=>{throw Error('R181 AWS read-only: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const STS=['sts','get-caller-identity'];
const IAM=new Set(['get-role','list-role-policies',
 'list-attached-role-policies','get-role-policy',
 'get-policy','get-policy-version','simulate-principal-policy']);
const S3=new Set(['head-object','get-object','get-object-retention',
 'get-bucket-replication','get-bucket-versioning',
 'get-public-access-block','get-object-lock-configuration']);
const flag=(k)=>'--'+k.replace(/[A-Z]/g,x=>'-'+x.toLowerCase());
export function createR181AwsCliExecutor({command='aws'}={}){
 ok(command==='aws','only system AWS CLI executable may be invoked');
 return async ({profile,region,service,operation,params={}})=>{
  ok(PROFILE.test(profile||'')&&/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region||'')&&
   ((service==='sts'&&operation==='get-caller-identity')||
    (service==='s3api'&&S3.has(operation))||
    (service==='iam'&&IAM.has(operation)))&&
   params&&Object.getPrototypeOf(params)===Object.prototype,
   'untrusted profile, command, region or mutating AWS action');
  const permitted=service==='sts'?[]:service==='iam'?
   (operation==='simulate-principal-policy'?
     ['PolicySourceArn','ActionNames','ResourceArns']:
     ['RoleName','PolicyName','PolicyArn','VersionId']):
   ['Bucket','Key','VersionId','ExpectedBucketOwner','ChecksumMode'];
  ok(Object.keys(params).every(k=>permitted.includes(k)&&
   typeof params[k]==='string'&&params[k].length<=1024&&
   !/[\x00-\x1f]/.test(params[k])),
   'unexpected S3 parameter in AWS CLI read-only operation');
  if(service==='iam'){
   if(operation==='simulate-principal-policy'){
    ok(Object.keys(params).length===3&&
     /^arn:aws:iam::[0-9]{12}:role\/marcosa-r178-readonly-auditor$/.test(
      params.PolicySourceArn||'')&&
     /^(?:s3:(?:PutObject|DeleteObject|PutBucketReplication|PutBucketPolicy)|kms:(?:CreateGrant|DisableKey|ScheduleKeyDeletion)|iam:(?:PassRole|PutRolePolicy|UpdateAssumeRolePolicy))$/.test(
      params.ActionNames||'')&&
     (/^arn:aws:s3:::[a-z0-9.-]{3,63}(?:\/marcosa\/isolated\/r178\/archive\/r184-probe\.bin)?$/.test(
       params.ResourceArns||'')||
      /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9-]{36}$/.test(
       params.ResourceArns||'')||
      params.ResourceArns===params.PolicySourceArn),
     'only exact fixed IAM policy-simulation deny probes permitted');
   }else if(operation==='get-policy'||operation==='get-policy-version'){
    ok(!('RoleName' in params)&&!('PolicyName' in params)&&
     typeof params.PolicyArn==='string'&&
     /^arn:aws:iam::[0-9]{12}:policy\/marcosa-staging-readonly-boundary$/.test(params.PolicyArn)&&
     (operation==='get-policy'?
      !('VersionId' in params):
      /^v[1-9][0-9]{0,2}$/.test(params.VersionId||'')),
     'IAM boundary policy ARN and version must be exact');
   }else{
    ok(params.RoleName==='marcosa-r178-readonly-auditor'&&
     !('PolicyArn' in params)&&!('VersionId' in params)&&
     (!('PolicyName' in params)||
      params.PolicyName==='marcosa-r182-staging-readonly'),
     'IAM role or inline policy is not pre-approved');
   }
  }
  const args=['--profile',profile,'--region',region,
   '--no-cli-pager',service,operation,'--output','json'];
  for(const [k,v] of Object.entries(params))args.push(flag(k),v);
  let folder;
  try{
   if(operation==='get-object'){
    folder=await mkdtemp(join(tmpdir(),'marcosa-r181-'));
    args.push(join(folder,'application-encrypted-object.bin'));
   }
   const r=spawnSync(command,args,{
    encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
    env:{...process.env,AWS_EC2_METADATA_DISABLED:'true',
     AWS_PAGER:'',AWS_DEFAULT_OUTPUT:'json',
     AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',
     AWS_SESSION_TOKEN:''}
   });
   ok(!r.error&&r.status===0&&r.stdout?.length<=1024*1024,
    'AWS CLI permission, timeout, malformed output or network failure');
   let json;
   try{json=JSON.parse(r.stdout);}catch{fail('AWS CLI did not return JSON');}
   if(!folder)return{json};
   const item=join(folder,'application-encrypted-object.bin');
   const info=await stat(item);
   ok(info.isFile()&&info.size>=512&&info.size<=16*1024*1024,
    'downloaded object size exceeded read-only bound');
   const bytes=await readFile(item);
   ok(bytes.length>=512&&bytes.length<=16*1024*1024,
    'read-only object must be a bounded application encrypted archive');
   return{json,bytes};
  }catch{fail('AWS read-only operation denied');}
  finally{if(folder)await rm(folder,{recursive:true,force:true});}
 };
}
const scope=x=>{
 const k=KMS.exec(x?.kmsKeyArn||'');
 ok(x&&PROFILE.test(x.profile||'')&&ACCOUNT.test(x.accountId||'')&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(x.bucket||'')&&
  k&&k[1]===x.region&&k[2]===x.accountId,
  'two independently scoped real AWS profiles with pinned KMS ARN required');
 return x;
};
export function createR181AwsReadOnlyProbe({source,offsite,
 executeAws,clock=()=>Date.now(),allowNetwork=false}={}){
 scope(source);scope(offsite);
 ok(source.profile!==offsite.profile&&source.accountId!==offsite.accountId&&
  source.bucket!==offsite.bucket&&source.region!==offsite.region&&
  typeof executeAws==='function'&&typeof clock==='function',
  'source and offsite AWS profiles/regions/accounts must be distinct');
 async function call(x,operation,params={},service='s3api'){
  ok(allowNetwork===true,'external AWS CLI network disabled by default');
  let r;
  try{r=await executeAws({profile:x.profile,region:x.region,
    service,operation,params});}catch{fail('AWS read-only '+operation+' failed');}
  ok(r&&r.json&&Object.getPrototypeOf(r.json)===Object.prototype,
   'bounded real AWS SDK/CLI response required');
  return r;
 }
 async function inspect({commit,bundleSha256,historyRootSha256,
  sha256,sourceVersionId,offsiteVersionId}={}){
  ok(allowNetwork===true&&H40.test(commit||'')&&
   [bundleSha256,historyRootSha256,sha256].every(x=>H64.test(x||''))&&
   VERSION.test(sourceVersionId||'')&&VERSION.test(offsiteVersionId||''),
   'read-only exact-version object, source bundle and history required');
  const key='marcosa/isolated/r178/archive/'+sha256+'.bin';
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted AWS audit clock required');
  const [srcIdentity,dstIdentity]=await Promise.all([
   call(source,'get-caller-identity',{},'sts'),
   call(offsite,'get-caller-identity',{},'sts')
  ]);
  ok(srcIdentity.json.Account===source.accountId&&
   dstIdentity.json.Account===offsite.accountId&&
   /^arn:aws:sts::\d{12}:assumed-role\/marcosa-r178-readonly-auditor\/[A-Za-z0-9_.-]+$/
    .test(srcIdentity.json.Arn||'')&&
   /^arn:aws:sts::\d{12}:assumed-role\/marcosa-r178-readonly-auditor\/[A-Za-z0-9_.-]+$/
    .test(dstIdentity.json.Arn||'')&&
   srcIdentity.json.Arn.includes(source.accountId)&&
   dstIdentity.json.Arn.includes(offsite.accountId),
   'STS profiles are not separately assumed/pinned read-only auditors');
  const rule=(await call(source,'get-bucket-replication',{
   Bucket:source.bucket,ExpectedBucketOwner:source.accountId})).json;
  const config=rule.ReplicationConfiguration;
  const r=config?.Rules?.[0];
  ok(config?.Rules?.length===1&&
   config.Role==='arn:aws:iam::'+source.accountId+
    ':role/marcosa-staging-cross-account-replication'&&
   r.Status==='Enabled'&&
   r.Filter?.Prefix==='marcosa/isolated/r178/archive/'&&
   r.DeleteMarkerReplication?.Status==='Disabled'&&
   r.Destination?.Bucket==='arn:aws:s3:::'+offsite.bucket&&
   r.Destination?.Account===offsite.accountId,
   'replication prefix, destination or role misconfigured');
  for(const t of [source,offsite]){
   const scope={Bucket:t.bucket,ExpectedBucketOwner:t.accountId};
   const [v,l,p]=await Promise.all([
    call(t,'get-bucket-versioning',scope),
    call(t,'get-object-lock-configuration',scope),
    call(t,'get-public-access-block',scope)
   ]);
   ok(v.json.Status==='Enabled'&&
    l.json.ObjectLockConfiguration?.ObjectLockEnabled==='Enabled'&&
    ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy',
     'RestrictPublicBuckets'].every(k=>
      p.json.PublicAccessBlockConfiguration?.[k]===true),
    'versioning, Object Lock and public access blocks must all be active');
  }
  async function check(t,version,status){
   const input={Bucket:t.bucket,Key:key,VersionId:version,
    ExpectedBucketOwner:t.accountId};
   const [h,ret,g]=await Promise.all([
    call(t,'head-object',{...input,ChecksumMode:'ENABLED'}),
    call(t,'get-object-retention',input),
    call(t,'get-object',{...input,ChecksumMode:'ENABLED'})
   ]);
   const j=h.json,ttl=Date.parse(ret.json.Retention?.RetainUntilDate);
   const expected=Buffer.from(sha256,'hex').toString('base64');
   ok(j.VersionId===version&&j.ReplicationStatus===status&&
    j.ContentLength>=512&&j.ContentLength<=16*1024*1024&&
    j.ContentType==='application/vnd.marcosa.r178-encrypted-archive'&&
    j.ServerSideEncryption==='aws:kms'&&j.SSEKMSKeyId===t.kmsKeyArn&&
    j.ChecksumSHA256===expected&&
    j.ObjectLockMode==='COMPLIANCE'&&
    ret.json.Retention.Mode==='COMPLIANCE'&&
    Number.isFinite(ttl)&&ttl>=now+7*86400000&&
    j.Metadata?.['marcosa-commit']===commit&&
    j.Metadata?.['marcosa-bundle-sha256']===bundleSha256&&
    j.Metadata?.['marcosa-history-root-sha256']===historyRootSha256&&
    g.json.VersionId===version&&
    g.json.ContentLength===j.ContentLength&&
    Buffer.isBuffer(g.bytes)&&g.bytes.length===j.ContentLength&&
    sha(g.bytes)===sha256,
    'wrong version, replica status, AES-GCM payload, SSE-KMS, retention or checksum');
   return j.ContentLength;
  }
  const sizes=await Promise.all([
   check(source,sourceVersionId,'COMPLETED'),
   check(offsite,offsiteVersionId,'REPLICA')
  ]);
  ok(sizes[0]===sizes[1],'source and replica application bytes differ');
  const finished=clock();
  ok(Number.isSafeInteger(finished)&&finished>=now&&
   finished-now<=60000,'AWS inspection became stale');
  const data={schemaVersion:1,commit,bundleSha256,historyRootSha256,
   sha256,sourceAccountId:source.accountId,
   offsiteAccountId:offsite.accountId,sourceVersionId,offsiteVersionId,
   applicationEncryptedBytes:sizes[0],checkedAtMs:finished,
   expiresAtMs:finished+60000,
   pinnedReadOnlyProfilesObserved:true,
   fullTwoAccountVersionReadbackShapeMatched:true,
   independentProviderAttestation:false,
   actualHumanApprovalVerified:false,
   productionAuthorized:false};
  return Object.freeze({...data,evidenceSha256:sha(Buffer.from(JSON.stringify(data)))});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,networkEnabled:allowNetwork,productionAuthorized:false})});
}
