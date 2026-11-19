import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {createR173OffsiteEscrowStore,issueR173Escrow,
 verifyR173Escrow} from '../r173/offsite-escrow.mjs';
const kp=generateKeyPairSync('ed25519'),now=1800000000000,clock=()=>now;
const repo='osmanosmanov6880-bot/marcosa-fusion';
const sourceKmsArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
const enc=randomBytes(98);
const data={
 commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),
 archiveId:'c'.repeat(32),archiveSha256:'d'.repeat(64),
 sourceVersionId:'source-v1',offsiteVersionId:'dest-v5',
 inventorySha256:'e'.repeat(64),
 sourceAccountId:'111122223333',offsiteAccountId:'444455556666',
 sourceKmsArn,offsiteKmsArn,
 sourceEncryptedKeySha256:'f'.repeat(64),
 offsiteEncryptedKeySha256:createHash('sha256').update(enc).digest('hex'),
 keyContextSha256:'1'.repeat(64),
 offsiteEncryptedKeyBase64:enc.toString('base64')
};
const receipt=issueR173Escrow({data,privateKey:kp.privateKey,clock});
const pinnedSignerSpkiSha256=receipt.signerSpkiSha256;
const commands=Object.fromEntries(['PutObject','HeadObject','GetObject'].map(x=>[
 x+'Command',class{constructor(input){this.name=x;this.input=input;}}
]));
function f({wrongSse=false,modified=false,shortRetention=false,
 conflict=false}={}){
 const objects=new Map(),calls=[];
 const client={send:async cmd=>{
  calls.push(cmd);
  const i=cmd.input;
  if(cmd.name==='PutObject'){
   if(conflict)throw Error('PreconditionFailed');
   const v='escrow-v123';
   objects.set(i.Key,{...i,VersionId:v,
    Body:modified?Buffer.from('WRONG'):Buffer.from(i.Body)});
   return{VersionId:v};
  }
  const value=objects.get(i.Key);
  if(!value)throw Error('missing');
  if(cmd.name==='HeadObject')return{
   VersionId:i.VersionId,ContentLength:value.ContentLength,
   ContentType:value.ContentType,ServerSideEncryption:'aws:kms',
   SSEKMSKeyId:wrongSse?sourceKmsArn:offsiteKmsArn,
   ObjectLockMode:'COMPLIANCE',
   ObjectLockRetainUntilDate:shortRetention?
    new Date(now+3600000):value.ObjectLockRetainUntilDate,
   ChecksumSHA256:value.ChecksumSHA256
  };
  return{VersionId:i.VersionId,ContentLength:value.ContentLength,
   Body:Buffer.from(value.Body)};
 }};
 const store=createR173OffsiteEscrowStore({
  client,commands,accountId:data.offsiteAccountId,bucket:'marcosa-offsite-ci',
  kmsKeyArn:offsiteKmsArn,pinnedSignerSpkiSha256,clock,
  allowExternalCalls:true
 });
 return{store,calls};
}
test('R173 signed isolated offsite escrow stored with SSE-KMS, compliance lock and independently read by SHA',async()=>{
 const verified=verifyR173Escrow({
  receipt,pinnedSignerSpkiSha256,expectedCommit:data.commit,
  expectedBundleSha256:data.bundleSha256,
  expectedArchiveSha256:data.archiveSha256,
  expectedOffsiteAccountId:data.offsiteAccountId,clock
 });
 assert.equal(verified.verified,true);
 assert.equal(verified.encryptedKey.equals(enc),true);
 const x=f(),saved=await x.store.save({receipt});
 assert.equal(saved.verifiedS3EscrowStorage,true);
 const read=await x.store.read({sha256:saved.sha256,
  versionId:saved.versionId,commit:data.commit,
  bundleSha256:data.bundleSha256,archiveSha256:data.archiveSha256});
 assert.equal(read.verified,true);
 assert.equal(read.receipt.manifest.offsiteEncryptedKeyBase64,enc.toString('base64'));
 assert.equal(saved.productionAuthorized,false);
});
test('R173 offsite escrow fails on wrong signed data, wrong pin, expired receipt and mismatched S3 KMS',async()=>{
 const fake={...receipt,manifest:{...receipt.manifest,archiveSha256:'0'.repeat(64)}};
 assert.throws(()=>verifyR173Escrow({receipt:fake,
  pinnedSignerSpkiSha256,
  expectedCommit:data.commit,expectedBundleSha256:data.bundleSha256,
  expectedArchiveSha256:data.archiveSha256,
  expectedOffsiteAccountId:data.offsiteAccountId,clock
 }),/R173 escrow/);
 assert.throws(()=>verifyR173Escrow({receipt,
  pinnedSignerSpkiSha256:'0'.repeat(64),
  expectedCommit:data.commit,expectedBundleSha256:data.bundleSha256,
  expectedArchiveSha256:data.archiveSha256,
  expectedOffsiteAccountId:data.offsiteAccountId,clock
 }),/R173 escrow/);
 assert.throws(()=>verifyR173Escrow({receipt,pinnedSignerSpkiSha256,
  expectedCommit:data.commit,expectedBundleSha256:data.bundleSha256,
  expectedArchiveSha256:data.archiveSha256,
  expectedOffsiteAccountId:data.offsiteAccountId,clock:()=>now+16*86400000
 }),/R173 escrow/);
 for(const opts of [{wrongSse:true},{shortRetention:true},{conflict:true}]){
  await assert.rejects(f(opts).store.save({receipt}),/R173 escrow/);
 }
});
test('R173 escrow code refuses real AWS S3 network unless explicitly opted in',async()=>{
 const store=createR173OffsiteEscrowStore({
  client:{send:async()=>{throw Error('network not allowed');}},
  commands,accountId:data.offsiteAccountId,bucket:'marcosa-offsite-ci',
  kmsKeyArn:offsiteKmsArn,pinnedSignerSpkiSha256,clock
 });
 await assert.rejects(store.save({receipt}),/network disabled/);
});
