import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {issueR175DualAnchor} from '../r175/dual-anchor.mjs';
import {createR175OffsiteAnchorStore} from '../r175/anchor-store.mjs';
const op=generateKeyPairSync('ed25519'),rev=generateKeyPairSync('ed25519');
const clock=()=>1800000000000;
const data={sequence:1,commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),
 archiveSha256:'c'.repeat(64),escrowSha256:'d'.repeat(64),
 checkpointSha256:'e'.repeat(64),priorAnchorSha256:'0'.repeat(64)};
const receipt=issueR175DualAnchor({
 data,operatorKey:op.privateKey,reviewerKey:rev.privateKey,clock
});
const pinnedOperatorSpkiSha256=receipt.approvals[0].signerSpkiSha256,
 pinnedReviewerSpkiSha256=receipt.approvals[1].signerSpkiSha256;
const commands=Object.fromEntries(['PutObject','HeadObject','GetObject']
 .map(name=>[name+'Command',class{
  constructor(input){this.type=name;this.input=input;}
 }]));
function fixture({tamper=false,badKms=false,badLock=false,
 wrongVersion=false,down=false}={}){
 const objects=new Map(),calls=[];
 const client={send:async cmd=>{
  calls.push(cmd);
  if(down)throw Error('offline');
  const v=cmd.input;
  if(cmd.type==='PutObject'){
   if(objects.has(v.Key))throw Error('conflict');
   objects.set(v.Key,{...v,versionId:'offsite-123'});
   return{VersionId:'offsite-123'};
  }
  const saved=objects.get(v.Key);
  if(!saved)throw Error('not found');
  if(cmd.type==='HeadObject')return{
   VersionId:wrongVersion?'other':saved.versionId,
   ContentLength:saved.ContentLength,ContentType:saved.ContentType,
   ServerSideEncryption:'aws:kms',
   SSEKMSKeyId:badKms?'wrong':saved.SSEKMSKeyId,
   ObjectLockMode:badLock?'GOVERNANCE':'COMPLIANCE',
   ObjectLockRetainUntilDate:saved.ObjectLockRetainUntilDate,
   ChecksumSHA256:saved.ChecksumSHA256};
  return{VersionId:saved.versionId,ContentLength:saved.ContentLength,
   Body:tamper?Buffer.alloc(saved.ContentLength,4):Buffer.from(saved.Body)};
 }};
 const store=createR175OffsiteAnchorStore({client,commands,
  bucket:'marcosa-offsite-ci-locked',accountId:'444455556666',
  kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab',
  pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
  clock,allowExternalCalls:true});
 return{store,calls};
}
test('R175 independently read back version-specific immutable signed anchor',async()=>{
 const f=fixture();
 const saved=await f.store.save({receipt,expected:data});
 assert.equal(saved.immutableVersionChecked,true);
 const read=await f.store.read({sha256:saved.sha256,
  versionId:saved.versionId,expected:data});
 assert.equal(read.verified,true);
 assert.equal(read.productionAuthorized,false);
 assert.equal(read.receipt.anchorSha256,receipt.anchorSha256);
 assert.equal(f.calls[0].input.IfNoneMatch,'*');
});
test('R175 rejects body tamper, non-compliance S3, wrong KMS and version substitution',async()=>{
 for(const q of [{tamper:true},{badKms:true},{badLock:true},
  {wrongVersion:true},{down:true}]){
  const f=fixture(q);
  if(q.tamper){const s=await f.store.save({receipt,expected:data});
   await assert.rejects(f.store.read({sha256:s.sha256,
    versionId:s.versionId,expected:data}),/R175 offsite anchor store/);}
  else await assert.rejects(f.store.save({receipt,expected:data}),
   /R175 offsite anchor store/);
 }
});
test('R175 requires explicit offsite opt-in',async()=>{
 const f=createR175OffsiteAnchorStore({
  client:{send:async()=>{throw Error('network');}},commands,
  bucket:'marcosa-offsite-ci-locked',accountId:'444455556666',
  kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab',
  pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,clock
 });
 await assert.rejects(f.save({receipt,expected:data}),
  /R175 offsite anchor store/);
});
