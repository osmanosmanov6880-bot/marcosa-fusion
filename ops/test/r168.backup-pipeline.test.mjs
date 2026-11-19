import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {sealR165Backup,openR165Backup} from '../r165/encrypted-backup.mjs';
import {createR168BackupPipeline} from '../r168/backup-pipeline.mjs';
import {r168KmsContext} from '../r168/aws-kms.mjs';
const keyArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';
const time=1800000000000;
const sha=x=>createHash('sha256').update(x).digest('hex');
const inv=()=>({nonceCount:2,quarantineClosed:true,quarantineGeneration:5,
 // R167 synthetic source/target schema:
 auditHead:'c'.repeat(64),auditRows:3,publicRows:3,privateRows:2,
 activeSessions:1,revokedSessions:1,privateRls:true,publicRls:true,
 browserCanReadPrivate:false,readerCanReadPrivate:true,
 writerCanDeleteAudit:false,rowsDigest:'f'.repeat(64)});
function fixture({tamper=false,failedRestore=false}={}){
 const commit='a'.repeat(40),bundleSha256='b'.repeat(64),archiveId='c'.repeat(32),
  secret=randomBytes(32),ctx=r168KmsContext({commit,bundleSha256,archiveId});
 let object,issued=0,wiped,restored=0;
 const kms={keyArn,region:'eu-west-1',accountId:'111122223333',
  async issue(){
   issued++;
   const plaintextKey=Buffer.from(secret);wiped=plaintextKey;
   return{plaintextKey,encryptedKey:Buffer.alloc(100,1),keyArn,
    encryptionContext:ctx};
  },
  async unwrap(){return{plaintextKey:Buffer.from(secret)};}};
 const s3={bucket:'marcosa-ci-locked',kmsKeyArn:keyArn,
  region:'eu-west-1',accountId:'111122223333',
  async put({blob,encryptedKey,contextSha256}){
   object={blob,encryptedKey,contextSha256};
   return {sha256:sha(blob),versionId:'version-r168-1',
    complianceObjectLockVerified:true,productionAuthorized:false};
  },
  async get(){const blob=Buffer.from(object.blob);
   if(tamper)blob[blob.length-30]^=1;
   return{blob,encryptedKey:object.encryptedKey,
    sha256:sha(object.blob),remoteObjectVersionVerified:true,
    complianceRetentionVerified:true};
  }};
 const preflight={inspect:async()=>({passed:true,accountId:'111122223333',
  region:'eu-west-1',bucket:'marcosa-ci-locked',kmsKeyArn:keyArn,
  checkedAtMs:time,expiresAtMs:time+60000,objectLockCompliance:true,
  versioningEnabled:true,publicAccessBlocked:true,productionAuthorized:false})};
 const pipe=createR168BackupPipeline({kms,s3,preflight,clock:()=>time});
 const data={plaintext:Buffer.concat([Buffer.from('PGDMP'),randomBytes(2048)]),
  commit,bundleSha256,archiveId,sourceInventory:inv()};
 return{pipe,data,metrics:()=>({issued,wiped,restored}),
  restoreIntoDisposableDatabase:async({database,plaintext})=>{
   assert.equal(database,'marcosa_r168_restored');
   assert.deepEqual(plaintext,data.plaintext);
   restored++;
   return {success:!failedRestore,database};
  },readRestoredInventory:async()=>inv()};
}
test('R168 composed KMS+S3 binary PGDMP backup zeroizes DEK and recovers after independent witness',async()=>{
 const x=fixture(),saved=await x.pipe.backup(x.data);
 assert.equal(x.metrics().issued,1);
 assert.ok(x.metrics().wiped.every(b=>b===0));
 const accepted=await x.pipe.rehearseRecovery({reference:saved.reference,
  sourceInventory:saved.sourceInventory,pinnedInventorySha256:saved.reference.inventorySha256,
  restoreIntoDisposableDatabase:x.restoreIntoDisposableDatabase,
  readRestoredInventory:x.readRestoredInventory});
 assert.equal(accepted.verified,true);
 assert.equal(accepted.productionAuthorized,false);
 assert.equal(x.metrics().restored,1);
});
test('R168 rejected tampering, non-pinned inventory and failed target restore remain NO_GO',async()=>{
 for(const opt of [{tamper:true},{failedRestore:true}]){
  const x=fixture(opt),saved=await x.pipe.backup(x.data);
  await assert.rejects(x.pipe.rehearseRecovery({reference:saved.reference,
   sourceInventory:saved.sourceInventory,pinnedInventorySha256:saved.reference.inventorySha256,
   restoreIntoDisposableDatabase:x.restoreIntoDisposableDatabase,
   readRestoredInventory:x.readRestoredInventory}),/R168 recovery/);
 }
 const y=fixture(),saved=await y.pipe.backup(y.data);
 await assert.rejects(y.pipe.rehearseRecovery({reference:saved.reference,
  sourceInventory:saved.sourceInventory,pinnedInventorySha256:'0'.repeat(64),
  restoreIntoDisposableDatabase:y.restoreIntoDisposableDatabase,
  readRestoredInventory:y.readRestoredInventory}),/independently pinned/);
});
