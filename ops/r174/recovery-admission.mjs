/**
 * R174 deterministic recovery admission: offsite escrow + monotonic archive
 * checkpoint + independently audited destination KMS. No automatic
 * selection of "latest" version from S3 listing; only approved PG sequence.
 * All staleness checks are relative to a pinned expected recovery timestamp.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {verifyR173Escrow} from '../r173/offsite-escrow.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R174 recovery admission: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const eq=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function r174RecoveryEvidenceDigest({
 sequence,commit,bundleSha256,archiveSha256,escrowSha256,
 offsiteKmsArn,archivedAtMs
}={}){
 ok(Number.isSafeInteger(sequence)&&sequence>0&&
  H40.test(commit||'')&&
  [bundleSha256,archiveSha256,escrowSha256].every(x=>H64.test(x||''))&&
  /^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9-]{36}$/.test(offsiteKmsArn||'')&&
  Number.isSafeInteger(archivedAtMs)&&archivedAtMs>0,
  'exact checkpoint and second CMK identity required');
 return createHash('sha256').update(JSON.stringify({
  schemaVersion:1,scope:'r174-no-rollback-recovery',
  sequence,commit,bundleSha256,archiveSha256,
  escrowSha256,offsiteKmsArn,archivedAtMs,productionAuthorized:false
 })).digest('hex');
}
export function createR174RecoveryAdmission({
 readCheckpoint,readEscrow,auditOffsiteKms,clock=()=>Date.now(),
 maxArchiveAgeMs=6*3600000,allowAdmission=false
}={}){
 ok([readCheckpoint,readEscrow,auditOffsiteKms].every(x=>typeof x==='function')&&
  typeof clock==='function'&&
  Number.isSafeInteger(maxArchiveAgeMs)&&
  maxArchiveAgeMs>=60000&&maxArchiveAgeMs<=86400000,
  'independent read-only checkpoint, escrow and KMS inspectors required');
 async function inspect({sequence,commit,bundleSha256,archiveSha256,
  escrowSha256,escrowVersionId,archivedAtMs,
  offsiteAccountId,offsiteKmsArn,pinnedSignerSpkiSha256
 }={}){
  ok(allowAdmission===true,'recovery admission disabled without isolated opt-in');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0&&
   Number.isSafeInteger(archivedAtMs)&&archivedAtMs<=now+10000&&
   now-archivedAtMs<=maxArchiveAgeMs,
   'backup is stale/future dated beyond isolated recovery window');
  const [checkpoint,escrow,kms]=await Promise.all([
   readCheckpoint(),readEscrow({
    sha256:escrowSha256,versionId:escrowVersionId,
    commit,bundleSha256,archiveSha256
   }),auditOffsiteKms()
  ]);
  ok(checkpoint?.sequence===sequence&&
   checkpoint.source_commit===commit&&
   checkpoint.archive_sha256===archiveSha256&&
   checkpoint.escrow_sha256===escrowSha256&&
   checkpoint.archived_at_ms===archivedAtMs&&
   checkpoint.production_authorized===false,
   'newer registered archive exists or checkpoint does not match');
  const expected=r174RecoveryEvidenceDigest({
   sequence,commit,bundleSha256,archiveSha256,escrowSha256,
   offsiteKmsArn,archivedAtMs
  });
  ok(eq(checkpoint.evidence_sha256,expected)&&
   escrow?.verified===true&&escrow?.sha256===escrowSha256&&
   escrow?.versionId===escrowVersionId&&
   kms?.checked===true&&kms.keyArn===offsiteKmsArn&&
   kms.accountId===offsiteAccountId&&kms.exactPinnedKeyPolicy===true&&
   kms.noUnexpectedGrants===true&&kms.rotationEnabled===true&&
   kms.productionAuthorized===false&&
   kms.checkedAtMs<=now&&kms.expiresAtMs>=now,
   'signed archive checkpoint, offsite KMS policy or escrow invalid');
  const verified=verifyR173Escrow({
   receipt:escrow.receipt,pinnedSignerSpkiSha256,
   expectedCommit:commit,expectedBundleSha256:bundleSha256,
   expectedArchiveSha256:archiveSha256,
   expectedOffsiteAccountId:offsiteAccountId,clock
  });
  const m=verified.manifest;
  ok(m.offsiteKmsArn===offsiteKmsArn&&
   m.archivedAtMs===undefined&&
   m.archiveSha256===checkpoint.archive_sha256&&
   checkpoint.escrow_sha256===escrowSha256,
   'escrow bound to different checkpoint or key');
  // Final read AFTER parallel AWS calls: rejects checkpoint change while
  // inspecting. This still does not replace a transactional SQL lease.
  const final=await readCheckpoint();
  ok(final?.sequence===sequence&&
   final.archive_sha256===checkpoint.archive_sha256&&
   final.escrow_sha256===checkpoint.escrow_sha256&&
   eq(final.evidence_sha256,expected),
   'archive checkpoint advanced during offsite inspection');
  return Object.freeze({
   accepted:true,sequence,commit,archiveSha256,
   escrowSha256,escrowVersionId,offsiteKmsArn,
   evidenceSha256:expected,observedAtMs:now,
   noOlderCheckpointSelected:true,
   externalAwsIdentityIndependentlyProven:false,
   liveOffsiteAccountConfirmed:false,productionAuthorized:false
  });
 }
 return Object.freeze({inspect});
}
