/**
 * R173 OFFSITE-ONLY isolated disaster recovery. Once the escrow is signed,
 * the original source S3 account and source KMS must never be contacted.
 * The second destination KMS unwraps a separately wrapped AES-256 DEK.
 * Approval: independently pinned Ed25519 keys + one-use SQL nonce.
 * Plaintext DEK and native PGDMP are zeroized after pg_restore.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {openR165Backup} from '../r165/encrypted-backup.mjs';
import {verifyR164DualReview} from '../r164/change-quorum.mjs';
import {verifyR167RestoredInventory} from '../r167/transfer-manifest.mjs';
import {verifyR173Escrow} from './offsite-escrow.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,VER=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R173 offsite recovery: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
export function r173OffsiteTargetDigest({commit,bundleSha256,archiveSha256,
 sourceInventorySha256,escrowSha256,escrowVersionId,
 offsiteAccountId,offsiteKmsArn}={}){
 ok(H40.test(commit||'')&&
  [bundleSha256,archiveSha256,sourceInventorySha256,escrowSha256].every(
   x=>H64.test(x||''))&&VER.test(escrowVersionId||'')&&
  /^[0-9]{12}$/.test(offsiteAccountId||'')&&
  typeof offsiteKmsArn==='string'&&offsiteKmsArn.startsWith(
   'arn:aws:kms:')&&offsiteKmsArn.includes(':'+offsiteAccountId+':key/'),
  'full pinned source and second AWS account digest required');
 return sha(Buffer.from(JSON.stringify({
  schemaVersion:1,scope:'isolated-offsite-disaster-rehearsal',
  commit,bundleSha256,archiveSha256,sourceInventorySha256,
  escrowSha256,escrowVersionId,offsiteAccountId,offsiteKmsArn,
  productionAuthorized:false
 })));
}
export function createR173OffsiteRecovery({
 offsiteObject,escrowStore,offsiteKms,quarantine,
 consumeNonce,restoreNativePg,readRestoredInventory,
 verifyRestoredNonceReplay,
 clock=()=>Date.now(),monotonicClock=()=>performance.now(),
 maxRestoreMs=120000,allowRecovery=false
}={}){
 ok(offsiteObject&&typeof offsiteObject.read==='function'&&
  escrowStore&&typeof escrowStore.read==='function'&&
  offsiteKms&&typeof offsiteKms.unwrap==='function'&&
  quarantine&&typeof quarantine.status==='function'&&
  [consumeNonce,restoreNativePg,readRestoredInventory,
   verifyRestoredNonceReplay].every(x=>typeof x==='function')&&
  typeof clock==='function'&&typeof monotonicClock==='function'&&
  Number.isInteger(maxRestoreMs)&&maxRestoreMs>=1000&&
  maxRestoreMs<=300000,
  'exact offsite SDK, PostgreSQL and one-use controls required');
 async function rehearse({
  commit,bundleSha256,archiveSha256,sourceInventory,
  escrowSha256,escrowVersionId,offsiteAccountId,offsiteKmsArn,
  pinnedSignerSpkiSha256,packet,approvals,pinnedReviewerFingerprints
 }={}){
  ok(allowRecovery===true,'offsite recovery disabled without isolated opt-in');
  verifyR167RestoredInventory({source:sourceInventory,restored:sourceInventory});
  const sourceInventorySha256=sha(Buffer.from(JSON.stringify(sourceInventory)));
  const targetDigest=r173OffsiteTargetDigest({
   commit,bundleSha256,archiveSha256,sourceInventorySha256,
   escrowSha256,escrowVersionId,offsiteAccountId,offsiteKmsArn
  });
  const reviewed=verifyR164DualReview({
   packet,approvals,pinnedReviewerFingerprints,commit,targetDigest,clock
  });
  ok(reviewed.signatureCount===2&&reviewed.synthetic===true&&
   reviewed.productionAuthorized===false,
   'only two pinned keys can authorize isolated synthetic offsite recovery');
  const initial=await quarantine.status();
  ok(initial?.closed===true&&Number.isSafeInteger(initial.generation)&&
   initial.generation>=5,'SQL quarantine not closed before offsite access');
  const remote=await escrowStore.read({
   sha256:escrowSha256,versionId:escrowVersionId,
   commit,bundleSha256,archiveSha256
  });
  ok(remote?.verified===true&&
   remote.sha256===escrowSha256&&
   remote.versionId===escrowVersionId,
   'immutable offsite escrow not independently retrieved');
  const proof=verifyR173Escrow({
   receipt:remote.receipt,pinnedSignerSpkiSha256,
   expectedCommit:commit,expectedBundleSha256:bundleSha256,
   expectedArchiveSha256:archiveSha256,
   expectedOffsiteAccountId:offsiteAccountId,clock
  });
  const m=proof.manifest;
  ok(m.inventorySha256===sourceInventorySha256&&
   m.offsiteKmsArn===offsiteKmsArn,
   'offsite key, database inventory or source binding differs');
  // S3 source version is only a signed reference. DO NOT read source S3.
  const ciphertext=await offsiteObject.read({
   sha256:archiveSha256,sourceVersionId:m.sourceVersionId,
   offsiteVersionId:m.offsiteVersionId,
   commit,bundleSha256,archiveId:m.archiveId,
   contextSha256:m.keyContextSha256===undefined?'':m.keyContextSha256,
   compareSource:false
  });
  ok(ciphertext?.crossAccountCiphertextReadbackVerified===true&&
   ciphertext.sourceComparedThisRun===false&&
   ciphertext.sha256===archiveSha256&&
   ciphertext.offsiteVersionId===m.offsiteVersionId&&
   ciphertext.destinationSseKmsKeyArn===offsiteKmsArn&&
   Buffer.isBuffer(ciphertext.blob)&&
   Buffer.isBuffer(ciphertext.encryptedSourceKey)&&
   sha(ciphertext.encryptedSourceKey)===m.sourceEncryptedKeySha256,
   'independent offsite ciphertext or original key metadata changed');
  // Consume durable SQL nonce before any offsite KMS decryption.
  let consumed;
  try{
   consumed=await consumeNonce({
    nonce:packet.nonce,commit,archiveSha256,
    reviewerDigest:targetDigest,
    roleArn:'arn:aws:iam::'+offsiteAccountId+
     ':role/marcosa-staging-backup-role',
    productionAuthorized:false
   });
  }catch{fail('durable independent SQL replay fence rejected');}
  ok(consumed?.durablePostgresFence===true&&
   consumed?.rehearsalLeaseRecorded===true&&
   consumed.nonce===packet.nonce&&
   consumed.productionAuthorized===false,
   'durable independent recovery SQL nonce not consumed exactly once');
  let decrypted,opened;
  const start=monotonicClock();
  try{
   decrypted=await offsiteKms.unwrap({
    encryptedKey:proof.encryptedKey,
    encryptedKeySha256:m.offsiteEncryptedKeySha256,
    keyContextSha256:m.keyContextSha256,
    commit,bundleSha256,archiveId:m.archiveId
   });
   ok(decrypted?.sourceKeyNotRequired===true&&
    decrypted?.destKeyArn===offsiteKmsArn&&
    Buffer.isBuffer(decrypted.plaintextKey)&&
    decrypted.plaintextKey.length===32,
    'only offsite KMS may decrypt portable AES-256 data key');
   opened=openR165Backup({
    blob:ciphertext.blob,key:decrypted.plaintextKey,
    commit,bundleSha256,now:clock(),maxAgeMs:86400000
   });
   ok(opened.verified===true&&
    opened.plaintext.subarray(0,5).toString('utf8')==='PGDMP',
    'authenticated native PostgreSQL custom dump required');
   const restored=await restoreNativePg({
    database:'marcosa_r168_restored',plaintext:opened.plaintext,
    productionAuthorized:false
   });
   ok(restored?.success===true&&
    restored.database==='marcosa_r168_restored',
    'isolated PostgreSQL pg_restore refused');
   const inventory=await readRestoredInventory({database:'marcosa_r168_restored'});
   verifyR167RestoredInventory({source:sourceInventory,restored:inventory});
   const replay=await verifyRestoredNonceReplay({
    database:'marcosa_r168_restored',nonce:packet.nonce,
    commit,archiveSha256,productionAuthorized:false
   });
   ok(replay?.denied===true&&replay?.rowCount===1&&
    replay?.auditCount===1,
    'restored PostgreSQL nonce/audit missing or reuse accepted');
   const rtoMs=Math.ceil(monotonicClock()-start);
   ok(Number.isSafeInteger(rtoMs)&&rtoMs>=0&&rtoMs<=maxRestoreMs,
    'offsite test exceeded isolated recovery deadline');
   const end=await quarantine.status();
   ok(end?.closed===true&&end.generation===initial.generation,
    'independent control database quarantine changed');
   return Object.freeze({
    verified:true,commit,bundleSha256,archiveSha256,
    offsiteAccountId,escrowSha256,offsiteVersionId:m.offsiteVersionId,
    observedSyntheticOffsiteRecoveryMs:rtoMs,
    syntheticRowsLost:0,sourceS3AndKmsNotAccessedDuringRestore:true,
    signedOperatorAndReviewerKeysVerified:true,
    actualHumanSeparationVerified:false,
    realOffsiteAwsAccountUsed:false,actualProductionRtoProven:false,
    actualProductionRpoProven:false,productionAuthorized:false
   });
  }catch{fail('offsite KMS decrypt, PG17 restore or nonce parity failed');}
  finally{
   if(decrypted?.plaintextKey)decrypted.plaintextKey.fill(0);
   if(opened?.plaintext)opened.plaintext.fill(0);
  }
 }
 return Object.freeze({rehearse,publicStatus:()=>Object.freeze({
  externalAccessDisabled:allowRecovery!==true,
  productionAuthorized:false
 })});
}
