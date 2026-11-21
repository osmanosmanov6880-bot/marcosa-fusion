import test from 'node:test';
import assert from 'node:assert/strict';
import {createR171S3VersionAudit,verifyR171S3VersionAudit}
 from '../r171/s3-version-audit.mjs';
const now=1800000000000,clock=()=>now,sha256='a'.repeat(64),
 versionId='r171-version1',commit='b'.repeat(40),
 bundleSha256='c'.repeat(64),archiveId='d'.repeat(32),
 contextSha256='e'.repeat(64),accountId='111122223333',
 bucket='marcosa-ci-locked',
 kmsKeyArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const key='marcosa/isolated/r168/'+sha256+'.r165enc';
const input={sha256,versionId,commit,bundleSha256,archiveId,contextSha256};
const classes=Object.fromEntries(['ListObjectVersions','GetObjectLegalHold',
 'GetBucketPolicyStatus'].map(x=>[x+'Command',
  class{constructor(i){this.input=i;this.name=x;}}]));
function f({publicBucket=false,extraVersion=false,deleteMarker=false,
 wrongVersion=false,holdUnavailable=false,truncated=false,
 corruptBytes=false}={}){
 const calls=[];
 const client={send:async cmd=>{
  calls.push(cmd);
  if(cmd.name==='GetBucketPolicyStatus')
   return{PolicyStatus:{IsPublic:publicBucket}};
  if(cmd.name==='GetObjectLegalHold')
   return{LegalHold:{Status:holdUnavailable?'UNKNOWN':'OFF'}};
  return{IsTruncated:truncated,Versions:[
   {Key:key,VersionId:wrongVersion?'old':versionId,
    IsLatest:true,Size:2048},
   ...(extraVersion?[{Key:key,VersionId:'older',IsLatest:false,Size:2048}]:[])
  ],DeleteMarkers:deleteMarker?[{Key:key,VersionId:'delete-marker'}]:[]};
 }};
 const retention={inspect:async()=>({
  verified:true,sha256,versionId,bucket,accountId,kmsKeyArn,
  immutableVersionReadbackVerified:!corruptBytes,aesGcmNotDecrypted:true,
  independentOffsiteAccountVerified:false,
  productionAuthorized:false,
  bytes:2048,retainUntilMs:now+9*86400000,
  verifiedAtMs:now,expiresAtMs:now+60000
 })};
 return{auditor:createR171S3VersionAudit({client,commands:classes,
  retention,accountId,bucket,kmsKeyArn,
  clock,allowExternalCalls:true}),calls};
}
test('R171 S3 version-timeline, public-policy status and retention exact-version cross-check',async()=>{
 const x=f(),proof=await x.auditor.inspect(input);
 assert.equal(proof.verified,true);
 assert.equal(proof.versionCount,1);
 assert.equal(proof.legalHold,'OFF');
 assert.equal(proof.productionAuthorized,false);
 assert.equal(x.calls.length,3);
 assert.ok(x.calls.every(c=>c.input.ExpectedBucketOwner===accountId));
 assert.equal(verifyR171S3VersionAudit(proof,{sha256,versionId,bucket,
  accountId,kmsKeyArn,clock}).verified,true);
});
test('R171 S3 fails closed on public policy, multiple versions, delete markers, wrong ID, truncated list, unknown hold and bad content',async()=>{
 for(const variant of [
  {publicBucket:true},{extraVersion:true},{deleteMarker:true},
  {wrongVersion:true},{truncated:true},{holdUnavailable:true},
  {corruptBytes:true}
 ])await assert.rejects(f(variant).auditor.inspect(input),/R171 S3 version audit|R170 S3 witness/);
 const proof=await f().auditor.inspect(input);
 assert.throws(()=>verifyR171S3VersionAudit(proof,{sha256,versionId,bucket,
  accountId,kmsKeyArn,clock:()=>now+61000}),/R171 S3 version audit/);
});
test('R171 S3 version API network disabled unless operator opts in',async()=>{
 const o=createR171S3VersionAudit({
  client:{send:async()=>{throw Error('unexpected network');}},
  commands:classes,retention:{inspect:async()=>null},
  accountId,bucket,kmsKeyArn,clock
 });
 await assert.rejects(o.inspect(input),/network disabled/);
});
