/**
 * R168 KMS/S3 backup and isolated restore orchestration.
 * This orchestrator composes real SDK-shaped providers but never creates AWS
 * accounts, IAM credentials or production permissions. Returns no plaintext
 * backup; recovered bytes go only into a supplied disposable restore callback.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {sealR165Backup,openR165Backup} from '../r165/encrypted-backup.mjs';
import {r168KmsContext} from './aws-kms.mjs';
import {verifyR168Readiness} from './aws-preflight.mjs';
import {verifyR167RestoredInventory} from '../r167/transfer-manifest.mjs';
const COMMIT=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R168 recovery: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const keys=['archiveId','bundleSha256','commit','contextSha256',
 'encryptedSha256','inventorySha256','productionAuthorized','schemaVersion',
 'versionId'].sort().join(',');
function validRef(ref){
 ok(ref&&Object.getPrototypeOf(ref)===Object.prototype&&
  Object.keys(ref).sort().join(',')===keys&&ref.schemaVersion===1&&
  ref.productionAuthorized===false&&COMMIT.test(ref.commit||'')&&
  HASH.test(ref.bundleSha256||'')&&HASH.test(ref.encryptedSha256||'')&&
  HASH.test(ref.contextSha256||'')&&HASH.test(ref.inventorySha256||'')&&
  ID.test(ref.archiveId||'')&&
  typeof ref.versionId==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(ref.versionId),
  'strict source-bound immutable reference required');
 const expected=sha(Buffer.from(JSON.stringify(r168KmsContext({
  commit:ref.commit,bundleSha256:ref.bundleSha256,archiveId:ref.archiveId
 }))));
 ok(expected===ref.contextSha256,'independent KMS context digest mismatch');
}
export function createR168BackupPipeline({kms,s3,preflight,clock=()=>Date.now()}={}){
 ok(kms&&typeof kms.issue==='function'&&typeof kms.unwrap==='function'&&
  s3&&typeof s3.put==='function'&&typeof s3.get==='function'&&
  preflight&&typeof preflight.inspect==='function'&&
  typeof clock==='function'&&kms.keyArn===s3.kmsKeyArn&&
  kms.accountId===s3.accountId&&kms.region===s3.region,
  'source-bound KMS, S3 and IAM preflight required');
 async function ready(){
  const lease=await preflight.inspect();
  verifyR168Readiness(lease,{accountId:kms.accountId,
   region:kms.region,bucket:s3.bucket,kmsKeyArn:kms.keyArn,clock});
  return lease;
 }
 async function backup({plaintext,commit,bundleSha256,archiveId,sourceInventory}={}){
  ok(Buffer.isBuffer(plaintext)&&plaintext.length>=512&&
   plaintext.length<=25*1024*1024&&
   plaintext.subarray(0,5).toString('utf8')==='PGDMP'&&
   COMMIT.test(commit||'')&&HASH.test(bundleSha256||'')&&ID.test(archiveId||''),
   'only bounded native synthetic PGDMP and source allowed');
  // This is a strict synthetic-only witness, NOT a real customer row inventory.
  verifyR167RestoredInventory({source:sourceInventory,restored:sourceInventory});
  const inventorySha256=sha(Buffer.from(JSON.stringify(sourceInventory)));
  await ready();
  let generated;
  try{
   generated=await kms.issue({commit,bundleSha256,archiveId});
   ok(generated&&Buffer.isBuffer(generated.plaintextKey)&&
    generated.plaintextKey.length===32&&
    generated.keyArn===kms.keyArn&&Buffer.isBuffer(generated.encryptedKey),
    'provider failed to issue a pinned encrypted data key');
   const context=r168KmsContext({commit,bundleSha256,archiveId});
   ok(JSON.stringify(generated.encryptionContext)===JSON.stringify(context),
    'provider returned a mismatched encryption context');
   const contextSha256=sha(Buffer.from(JSON.stringify(context)));
   const sealed=sealR165Backup({plaintext,key:generated.plaintextKey,
    commit,bundleSha256,createdAtMs:clock()});
   const put=await s3.put({blob:sealed.blob,commit,bundleSha256,archiveId,
    encryptedKey:generated.encryptedKey,contextSha256});
   ok(put&&put.sha256===sealed.encryptedSha256&&
    put.complianceObjectLockVerified===true&&
    put.productionAuthorized===false,
    'S3 immutable receipt or content digest absent');
   const reference=Object.freeze({
    schemaVersion:1,commit,bundleSha256,archiveId,
    encryptedSha256:put.sha256,versionId:put.versionId,
    contextSha256,inventorySha256,productionAuthorized:false
   });
   validRef(reference);
   return Object.freeze({reference,sourceInventory,
    nativePg17SourceVerified:true,remoteReceiptVerified:true,
    approvedForProduction:false,externalKmsPolicyAudited:false,
    productionAuthorized:false});
  }catch{fail('KMS issuance, encryption or S3 immutable storage denied');}
  finally{if(generated?.plaintextKey)generated.plaintextKey.fill(0);}
 }
 async function rehearseRecovery({reference,sourceInventory,
  pinnedInventorySha256,restoreIntoDisposableDatabase,readRestoredInventory}={}){
  validRef(reference);
  ok(HASH.test(pinnedInventorySha256||'')&&
   pinnedInventorySha256===reference.inventorySha256&&
   sha(Buffer.from(JSON.stringify(sourceInventory)))===pinnedInventorySha256,
   'source inventory not independently pinned');
  verifyR167RestoredInventory({source:sourceInventory,restored:sourceInventory});
  ok(typeof restoreIntoDisposableDatabase==='function'&&
   typeof readRestoredInventory==='function',
   'disposable restore and independent SQL witness required');
  await ready();
  const args={commit:reference.commit,bundleSha256:reference.bundleSha256,
   archiveId:reference.archiveId};
  const fetched=await s3.get({sha256:reference.encryptedSha256,
   versionId:reference.versionId,...args,contextSha256:reference.contextSha256});
  ok(fetched?.remoteObjectVersionVerified===true&&
   fetched?.complianceRetentionVerified===true&&
   fetched.sha256===reference.encryptedSha256&&
   Buffer.isBuffer(fetched.encryptedKey)&&
   Buffer.isBuffer(fetched.blob)&&
   sha(fetched.blob)===reference.encryptedSha256,
   'remote ciphertext, version or retention not independently verified');
  let unwrapped,opened;
  try{
   unwrapped=await kms.unwrap({...args,encryptedKey:fetched.encryptedKey});
   ok(unwrapped&&Buffer.isBuffer(unwrapped.plaintextKey)&&
    unwrapped.plaintextKey.length===32,'KMS decrypt denied');
   opened=openR165Backup({blob:fetched.blob,key:unwrapped.plaintextKey,
    commit:reference.commit,bundleSha256:reference.bundleSha256,now:clock()});
   ok(opened.verified&&opened.plaintext.subarray(0,5).toString('utf8')==='PGDMP',
    'native PG17 archive not authenticated');
   const targetName='marcosa_r168_restored';
   const result=await restoreIntoDisposableDatabase({
    database:targetName,plaintext:opened.plaintext,
    productionAuthorized:false});
   ok(result?.success===true&&result.database===targetName,
    'isolated PostgreSQL restore did not complete');
   const witness=await readRestoredInventory({database:targetName});
   const equal=verifyR167RestoredInventory({source:sourceInventory,restored:witness});
   ok(equal.verified&&equal.rlsPreserved===true,
    'restored PostgreSQL rows, RLS or session status mismatch');
   return Object.freeze({verified:true,reference,
    independentSqlWitnessVerified:true,complianceRetentionVerified:true,
    restoredDatabase:targetName,realExternalAccountVerified:false,
    productionAuthorized:false});
  }catch{fail('remote restore, KMS unwrap or independent PG17 parity denied');}
  finally{
   if(unwrapped?.plaintextKey)unwrapped.plaintextKey.fill(0);
   if(opened?.plaintext)opened.plaintext.fill(0);
  }
 }
 return Object.freeze({backup,rehearseRecovery,publicStatus:()=>Object.freeze({
  kmsKeyArn:kms.keyArn,bucket:s3.bucket,region:s3.region,
  productionAuthorized:false,liveSupabaseConnected:false,
  realExternalAccountVerified:false})});
}
