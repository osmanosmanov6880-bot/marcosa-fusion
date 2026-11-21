import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {issueR173Escrow} from '../r173/offsite-escrow.mjs';
import {createR174RecoveryAdmission,r174RecoveryEvidenceDigest}
 from '../r174/recovery-admission.mjs';
const now=1800000000000,clock=()=>now,
 offsiteAccountId='444455556666',
 sourceKmsArn='arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 offsiteKmsArn='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 archiveSha256='c'.repeat(64),escrowSha256='d'.repeat(64),
 archivedAtMs=now-3600000,sequence=2,escrowVersionId='escrow-v2',
 kp=generateKeyPairSync('ed25519'),blob=randomBytes(96);
const signed=issueR173Escrow({
 data:{
  commit,bundleSha256,archiveSha256,archiveId:'e'.repeat(32),
  sourceVersionId:'src-v1',offsiteVersionId:'dest-v2',
  inventorySha256:'f'.repeat(64),
  sourceAccountId:'111122223333',offsiteAccountId,
  sourceKmsArn,offsiteKmsArn,
  sourceEncryptedKeySha256:'1'.repeat(64),
  offsiteEncryptedKeySha256:createHash('sha256').update(blob).digest('hex'),
  keyContextSha256:'2'.repeat(64),offsiteEncryptedKeyBase64:blob.toString('base64')
 },privateKey:kp.privateKey,clock
});
const evidence=r174RecoveryEvidenceDigest({
 sequence,commit,bundleSha256,archiveSha256,escrowSha256,
 offsiteKmsArn,archivedAtMs
});
const req={sequence,commit,bundleSha256,archiveSha256,
 escrowSha256,escrowVersionId,archivedAtMs,
 offsiteAccountId,offsiteKmsArn,pinnedSignerSpkiSha256:signed.signerSpkiSha256};
function f({higher=false,stale=false,swappedKms=false,weakKms=false,
 wrongEscrow=false,mutation=false,expiredProof=false}={}){
 let reads=0;
 const checkpoint=()=>({
  sequence:higher?sequence+1:mutation&&reads++>0?sequence+1:sequence,
  source_commit:commit,archive_sha256:archiveSha256,
  escrow_sha256:escrowSha256,archived_at_ms:archivedAtMs,
  evidence_sha256:evidence,production_authorized:false
 });
 const auditor=createR174RecoveryAdmission({
  readCheckpoint:async()=>checkpoint(),
  readEscrow:async()=>({
   verified:true,sha256:escrowSha256,versionId:escrowVersionId,
   receipt:wrongEscrow?{...signed,signature:'a'.repeat(86)}:signed
  }),
  auditOffsiteKms:async()=>({
   checked:true,keyArn:swappedKms?sourceKmsArn:offsiteKmsArn,
   accountId:offsiteAccountId,exactPinnedKeyPolicy:!weakKms,
   noUnexpectedGrants:true,rotationEnabled:true,
   checkedAtMs:now-1000,expiresAtMs:expiredProof?now-1:now+60000,
   productionAuthorized:false
  }),
  clock,maxArchiveAgeMs:stale?60000:6*3600000,allowAdmission:true
 });
 return auditor;
}
test('R174 recovery admission pins highest archive, exact escrow Ed25519 and independently audited offsite KMS',async()=>{
 const proof=await f().inspect(req);
 assert.equal(proof.accepted,true);
 assert.equal(proof.noOlderCheckpointSelected,true);
 assert.equal(proof.evidenceSha256,evidence);
 assert.equal(proof.productionAuthorized,false);
});
test('R174 refuses older checkpoint, changed checkpoint, stale object, swapped KMS and modified escrow',async()=>{
 for(const q of [
  {higher:true},{stale:true},{swappedKms:true},
  {weakKms:true},{wrongEscrow:true},{mutation:true},{expiredProof:true}
 ])await assert.rejects(f(q).inspect(req),/R174 recovery admission|R173 escrow/);
});
test('R174 recovery admission blocks network by default',async()=>{
 const a=createR174RecoveryAdmission({
  readCheckpoint:async()=>{throw Error('do not read');},
  readEscrow:async()=>{throw Error('do not read');},
  auditOffsiteKms:async()=>{throw Error('do not read');},
  clock
 });
 await assert.rejects(a.inspect(req),/disabled/);
});
