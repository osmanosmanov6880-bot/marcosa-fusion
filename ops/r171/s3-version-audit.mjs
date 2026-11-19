/**
 * R171 S3 version-timeline and account-public-policy audit.
 * Uses actual SDK v3 ListObjectVersions, GetObjectLegalHold and
 * GetBucketPolicyStatus APIs, plus R170 exact-version SHA-256 readback.
 * Read-only, no KMS Decrypt, no destructive API. A matching result
 * is not independent cross-account durability proof.
 */
import {verifyR170S3RetentionWitness} from '../r170/s3-retention.mjs';
const H40=/^[0-9a-f]{40}$/,H64=/^[0-9a-f]{64}$/,ID=/^[0-9a-f]{32}$/;
const VERSION=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R171 S3 version audit: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function createR171S3VersionAudit({
 client,commands,retention,accountId,bucket,kmsKeyArn,
 clock=()=>Date.now(),allowExternalCalls=false
}={}){
 ok(client&&typeof client.send==='function'&&commands&&
  ['ListObjectVersionsCommand','GetObjectLegalHoldCommand',
   'GetBucketPolicyStatusCommand'].every(name=>
    typeof commands[name]==='function')&&
  retention&&typeof retention.inspect==='function'&&
  /^[0-9]{12}$/.test(accountId||'')&&
  /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(bucket||'')&&
  /^arn:aws:kms:/.test(kmsKeyArn||'')&&
  typeof clock==='function',
  'pinned read-only S3 SDK and R170 full ciphertext witness required');
 async function request(Name,input){
  ok(allowExternalCalls===true,'S3 live version listing disabled without staging authorization');
  try{
   return await client.send(new commands[Name+'Command'](input),{
    abortSignal:AbortSignal.timeout(7000)
   });
  }catch{fail('S3 read-only audit request failed: '+Name);}
 }
 async function inspect({sha256,versionId,commit,bundleSha256,
  archiveId,contextSha256}={}){
  ok(allowExternalCalls===true,'S3 provider network disabled');
  ok(H64.test(sha256||'')&&VERSION.test(versionId||'')&&
   H40.test(commit||'')&&H64.test(bundleSha256||'')&&
   ID.test(archiveId||'')&&H64.test(contextSha256||''),
   'exact immutable version reference required');
  const key='marcosa/isolated/r168/'+sha256+'.r165enc';
  const base={Bucket:bucket,ExpectedBucketOwner:accountId};
  const [policy,versions,legal]=await Promise.all([
   request('GetBucketPolicyStatus',base),
   request('ListObjectVersions',{...base,Prefix:key,MaxKeys:100}),
   request('GetObjectLegalHold',{...base,Key:key,VersionId:versionId})
  ]);
  ok(policy?.PolicyStatus?.IsPublic===false,
   'AWS S3 classifies bucket policy as public');
  ok(versions?.IsTruncated===false&&
   Array.isArray(versions.Versions)&&versions.Versions.length===1&&
   Array.isArray(versions.DeleteMarkers)&&versions.DeleteMarkers.length===0,
   'incomplete listing, overwritten object or unexpected S3 delete marker');
  const found=versions.Versions[0];
  ok(found?.Key===key&&found.VersionId===versionId&&
   found.IsLatest===true&&Number.isSafeInteger(found.Size)&&
   found.Size>700&&found.Size<=25*1024*1024+2048,
   'version not latest, absent, wrong object key or unsafe size');
  ok(['ON','OFF'].includes(legal?.LegalHold?.Status),
   'legal hold status unavailable or invalid');
  const full=await retention.inspect({
   sha256,versionId,commit,bundleSha256,archiveId,contextSha256
  });
  verifyR170S3RetentionWitness(full,{
   sha256,versionId,bucket,accountId,kmsKeyArn,clock
  });
  ok(full.bytes===found.Size&&full.productionAuthorized===false,
   'listed S3 version not identical to checked full ciphertext');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'inspection time unavailable');
  return Object.freeze({
   verified:true,sha256,versionId,bucket,accountId,kmsKeyArn,
   objectSize:found.Size,objectKey:key,
   isLatest:true,deleteMarkerCount:0,versionCount:1,
   bucketPublicPolicy:false,legalHold:legal.LegalHold.Status,
   versionSpecificComplianceAndSha256Verified:true,
   reviewedAtMs:now,expiresAtMs:now+60000,
   sourceWasSeparateAwsAccount:false,
   awsOrganizationsScpReviewed:false,
   productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  readOnly:true,networkEnabled:allowExternalCalls,
  productionAuthorized:false
 })});
}
export function verifyR171S3VersionAudit(proof,{sha256,versionId,
 bucket,accountId,kmsKeyArn,clock=()=>Date.now()}={}){
 const now=clock();
 ok(proof&&proof.verified===true&&
  proof.sha256===sha256&&proof.versionId===versionId&&
  proof.bucket===bucket&&proof.accountId===accountId&&
  proof.kmsKeyArn===kmsKeyArn&&
  proof.bucketPublicPolicy===false&&
  proof.isLatest===true&&proof.versionCount===1&&
  proof.deleteMarkerCount===0&&
  proof.versionSpecificComplianceAndSha256Verified===true&&
  proof.sourceWasSeparateAwsAccount===false&&
  proof.awsOrganizationsScpReviewed===false&&
  proof.productionAuthorized===false&&
  Number.isSafeInteger(now)&&now>=proof.reviewedAtMs&&
  now<=proof.expiresAtMs&&proof.expiresAtMs-proof.reviewedAtMs<=60000,
  'S3 version listing/readback evidence incomplete or stale');
 return Object.freeze({verified:true,productionAuthorized:false});
}
