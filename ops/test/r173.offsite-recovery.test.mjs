import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash,generateKeyPairSync,sign} from 'node:crypto';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {issueR173Escrow} from '../r173/offsite-escrow.mjs';
import {createR173OffsiteRecovery,r173OffsiteTargetDigest}
 from '../r173/offsite-recovery.mjs';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
const now=1800000000000,clock=()=>now,commit='a'.repeat(40),
 bundleSha256='b'.repeat(64),offsiteAccountId='444455556666';
const sourceKmsArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
const sourceInventory={
 auditHead:'a'.repeat(64),auditRows:3,publicRows:3,privateRows:2,
 activeSessions:1,revokedSessions:1,privateRls:true,publicRls:true,
 browserCanReadPrivate:false,readerCanReadPrivate:true,
 writerCanDeleteAudit:false,rowsDigest:'f'.repeat(64),
 quarantineClosed:true,quarantineGeneration:5
};
const inventorySha256=createHash('sha256').update(JSON.stringify(sourceInventory)).digest('hex');
const native=Buffer.concat([Buffer.from('PGDMP'),randomBytes(1200)]);
const key=randomBytes(32);
const sealed=sealR165Backup({plaintext:native,key,
 commit,bundleSha256,createdAtMs:now});
const archiveSha256=sealed.encryptedSha256,escrowSha256='c'.repeat(64),
 escrowVersionId='escrow-v1',sourceVersionId='source-v1',offsiteVersionId='replica-v31',
 archiveId='d'.repeat(32),contextSha256='e'.repeat(64);
const userKey=generateKeyPairSync('ed25519'),offsiteEncryptedKey=randomBytes(96);
const encSha=createHash('sha256').update(offsiteEncryptedKey).digest('hex');
const sourceEncryptedKey=randomBytes(96);
const srcKeySha=createHash('sha256').update(sourceEncryptedKey).digest('hex');
const data={commit,bundleSha256,archiveSha256,archiveId,
 sourceVersionId,offsiteVersionId,inventorySha256,
 sourceAccountId:'111122223333',offsiteAccountId,
 sourceKmsArn,offsiteKmsArn,sourceEncryptedKeySha256:srcKeySha,
 offsiteEncryptedKeySha256:encSha,keyContextSha256:contextSha256,
 offsiteEncryptedKeyBase64:offsiteEncryptedKey.toString('base64')};
const signed=issueR173Escrow({data,privateKey:userKey.privateKey,clock});
const pinnedSignerSpkiSha256=signed.signerSpkiSha256;
function fixture({wrongCipher=false,wrongKey=false,failedNonce=false,
 badReplay=false,openGate=false,failDecrypt=false}={}){
 let access=0,consumes=0,restores=0,offsiteGets=0;
 const offsiteObject={read:async args=>{
  offsiteGets++;
  assert.equal(args.compareSource,false);
  return{crossAccountCiphertextReadbackVerified:true,
   sourceComparedThisRun:false,sha256:archiveSha256,offsiteVersionId,
   destinationSseKmsKeyArn:offsiteKmsArn,
   encryptedSourceKey:wrongKey?Buffer.alloc(96,9):sourceEncryptedKey,
   blob:wrongCipher?Buffer.alloc(sealed.blob.length,5):Buffer.from(sealed.blob)};
 }};
 const escrowStore={read:async()=>({verified:true,
  sha256:escrowSha256,versionId:escrowVersionId,receipt:signed})};
 const offsiteKms={unwrap:async args=>{
  access++;
  if(failDecrypt)throw Error('destination KMS denies decrypt');
  return{sourceKeyNotRequired:true,destKeyArn:offsiteKmsArn,
   plaintextKey:Buffer.from(key)};
 }};
 const quarantine={status:async()=>({closed:!openGate,generation:5})};
 const consumeNonce=async args=>{
  consumes++;
  if(failedNonce)throw Error('duplicate nonce');
  return{durablePostgresFence:true,rehearsalLeaseRecorded:true,
   nonce:args.nonce,productionAuthorized:false};
 };
 const restoreNativePg=async args=>{
  restores++;
  assert.equal(args.database,'marcosa_r168_restored');
  assert.equal(args.plaintext.equals(native),true);
  return{database:args.database,success:true};
 };
 const readRestoredInventory=async()=>sourceInventory;
 const verifyRestoredNonceReplay=async()=>({denied:!badReplay,
  rowCount:1,auditCount:1});
 const drill=createR173OffsiteRecovery({
  offsiteObject,escrowStore,offsiteKms,quarantine,consumeNonce,
  restoreNativePg,readRestoredInventory,verifyRestoredNonceReplay,
  clock,monotonicClock:()=>100,allowRecovery:true
 });
 const targetDigest=r173OffsiteTargetDigest({
  commit,bundleSha256,archiveSha256,sourceInventorySha256:inventorySha256,
  escrowSha256,escrowVersionId,offsiteAccountId,offsiteKmsArn
 });
 const packet=createR164DrillChallenge({commit,targetDigest,clock,
  nonce:'e'.repeat(32)});
 const reviewers=['operator','independent-reviewer'].map(role=>{
  const kp=generateKeyPairSync('ed25519');
  return{role,privateKey:kp.privateKey,
   publicKeyPem:kp.publicKey.export({format:'pem',type:'spki'})};
 });
 const approvals=reviewers.map(r=>({
  role:r.role,publicKeyPem:r.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),
   r.privateKey).toString('base64url')
 }));
 const pinnedReviewerFingerprints=Object.fromEntries(reviewers.map(r=>[
  r.role,r164ReviewerFingerprint(r.publicKeyPem)]));
 const req={commit,bundleSha256,archiveSha256,sourceInventory,
  escrowSha256,escrowVersionId,offsiteAccountId,offsiteKmsArn,
  pinnedSignerSpkiSha256,packet,approvals,pinnedReviewerFingerprints};
 return{drill,req,counts:()=>({access,consumes,restores,offsiteGets})};
}
test('R173 signed and SQL-fenced offsite-only AES-GCM PGDMP restores with source account absent',async()=>{
 const f=fixture();
 const res=await f.drill.rehearse(f.req);
 assert.equal(res.verified,true);
 assert.equal(res.syntheticRowsLost,0);
 assert.equal(res.sourceS3AndKmsNotAccessedDuringRestore,true);
 assert.equal(res.productionAuthorized,false);
 assert.deepEqual(f.counts(),{access:1,consumes:1,restores:1,offsiteGets:1});
});
test('R173 denies forged dual signers, missing nonce, swapped source metadata or tampered ciphertext',async()=>{
 for(const opts of [
  {failedNonce:true},{wrongKey:true},{wrongCipher:true},
  {badReplay:true},{openGate:true},{failDecrypt:true}
 ])await assert.rejects(fixture(opts).drill.rehearse(fixture().req),
  /R173 offsite recovery|R165/);
 const f=fixture();const q={...f.req,approvals:f.req.approvals.slice(0,1)};
 await assert.rejects(f.drill.rehearse(q),/R164 quorum/);
 assert.deepEqual(f.counts(),{access:0,consumes:0,restores:0,offsiteGets:0});
});
test('R173 recovery refuses external operations before explicit staging opt-in',async()=>{
 const f=fixture();
 const d=createR173OffsiteRecovery({
  offsiteObject:{read:async()=>{throw Error('network');}},
  escrowStore:{read:async()=>{throw Error('network');}},
  offsiteKms:{unwrap:async()=>{throw Error('network');}},
  quarantine:{status:async()=>({closed:true,generation:5})},
  consumeNonce:async()=>null,restoreNativePg:async()=>null,
  readRestoredInventory:async()=>null,verifyRestoredNonceReplay:async()=>null
 });
 await assert.rejects(d.rehearse(f.req),/disabled/);
});
