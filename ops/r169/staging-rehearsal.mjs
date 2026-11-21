/**
 * R169 staging-only, one-time disaster-recovery rehearsal orchestrator.
 * Confirms exact GitHub job, IAM policy, AWS preflight/posture, two Ed25519
 * reviewer signatures, durable SQL nonce, CLOSED quarantine, S3/KMS backup
 * and independent disposable PostgreSQL restore before success.
 *
 * This explicitly does NOT grant real production or live Supabase access.
 */
import {createHash} from 'node:crypto';
import {assertR169IsolatedRunner} from './aws-runtime.mjs';
import {verifyR169IamPlan} from './iam-plan.mjs';
import {verifyR169CloudPosture} from './cloud-posture.mjs';
import {verifyR168Readiness} from '../r168/aws-preflight.mjs';
import {verifyR164DualReview} from '../r164/change-quorum.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R169 staging drill: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');

export function r169TargetDigest({
 commit,bundleSha256,sourceInventory,roleArn
}={}){
 ok(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof roleArn==='string'&&
  /^arn:aws:iam::\d{12}:role\/marcosa-staging-backup-role$/.test(roleArn)&&
  sourceInventory&&typeof sourceInventory==='object'&&!Array.isArray(sourceInventory),
  'commit, signed source/role and inventory required');
 return sha(Buffer.from(JSON.stringify({
  schemaVersion:1,scope:'synthetic-staging-only',
  commit,bundleSha256,roleArn,
  inventorySha256:sha(Buffer.from(JSON.stringify(sourceInventory))),
  productionAuthorized:false
 })));
}
export function createR169StagingRehearsal({
 iamPlan,iamExpected,preflight,posture,quarantine,durableQuorum,
 pipeline,clock=()=>Date.now(),env=process.env
}={}){
 ok(iamPlan&&iamExpected&&preflight&&
  typeof preflight.inspect==='function'&&posture&&
  typeof posture.inspect==='function'&&quarantine&&
  typeof quarantine.status==='function'&&durableQuorum&&
  typeof durableQuorum.consume==='function'&&pipeline&&
  typeof pipeline.backup==='function'&&
  typeof pipeline.rehearseRecovery==='function'&&
  typeof clock==='function','full injected AWS/SQL safety chain required');
 const info={
  accountId:iamPlan.accountId,region:iamPlan.region,
  bucket:iamPlan.bucketName,kmsKeyArn:iamPlan.kmsKeyArn
 };
 async function execute({commit,bundleSha256,archiveId,sourceInventory,
  plaintext,approvals,packet,pinnedReviewerFingerprints,
  restoreIntoDisposableDatabase,readRestoredInventory}={}){
  assertR169IsolatedRunner({env,clock});
  verifyR169IamPlan(iamPlan,iamExpected);
  ok(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
   Buffer.isBuffer(plaintext)&&plaintext.length>512&&
   plaintext.subarray(0,5).toString('utf8')==='PGDMP',
   'native disposable PG17 source required');
  const digest=r169TargetDigest({
   commit,bundleSha256,sourceInventory,roleArn:iamPlan.AWS_ROLE_ARN});
  // Signatures are checked BEFORE any AWS write. Runtime crypto keys do not
  // establish real human separation.
  const proof=verifyR164DualReview({
   packet,approvals,pinnedReviewerFingerprints,
   commit,targetDigest:digest,clock
  });
  ok(proof.productionAuthorized===false&&proof.synthetic===true&&
   proof.signatureCount===2&&proof.distinctPinnedKeys===true,
   'two fresh synthetic Ed25519 review approvals required');
  const gateBefore=await quarantine.status();
  ok(gateBefore.closed===true&&
   Number.isSafeInteger(gateBefore.generation)&&gateBefore.generation>=3,
   'SQL staging quarantine must already be closed');
  const ready=await preflight.inspect();
  verifyR168Readiness(ready,{...info,clock});
  const postureLease=await posture.inspect();
  verifyR169CloudPosture(postureLease,{...info,clock});
  ok(ready.identityArn==='arn:aws:sts::'+iamPlan.accountId+
   ':assumed-role/'+iamPlan.roleName+'/ci-r169',
   'signed AWS STS identity must match specifically pinned rehearsal session');
  // A real R165 quorum stores the nonce in PostgreSQL and rejects retries,
  // including retries on a different Node process.
  const lease=await durableQuorum.consume({
   packet,approvals,pinnedReviewerFingerprints,
   commit,targetDigest:digest
  });
  ok(lease?.rehearsalLeaseRecorded===true&&
   lease?.durablePostgresFence===true&&lease?.nonce===packet.nonce&&
   lease?.productionAuthorized===false,
   'durable SQL one-time approval receipt not established');
  let saved,recovery;
  try{
   saved=await pipeline.backup({
    plaintext,commit,bundleSha256,archiveId,sourceInventory
   });
   ok(saved?.remoteReceiptVerified===true&&
    saved?.reference?.productionAuthorized===false&&
    saved.reference.commit===commit&&
    saved.reference.bundleSha256===bundleSha256,
    'remote encrypted archive write not confirmed');
   recovery=await pipeline.rehearseRecovery({
    reference:saved.reference,sourceInventory,
    pinnedInventorySha256:saved.reference.inventorySha256,
    restoreIntoDisposableDatabase,readRestoredInventory
   });
   ok(recovery?.verified===true&&
    recovery.restoredDatabase==='marcosa_r168_restored'&&
    recovery.productionAuthorized===false,
    'isolated PostgreSQL17 restore not independently verified');
  }catch{
   fail('rehearsal incomplete or security signal changed; nonce remains consumed');
  }
  const gateAfter=await quarantine.status();
  ok(gateAfter.closed===true&&
   gateAfter.generation===gateBefore.generation,
   'quarantine reopened or generation changed during rehearsal');
  return Object.freeze({
   verified:true,nonce:proof.nonce,sourceCommit:commit,
   encryptedSha256:saved.reference.encryptedSha256,
   restoreDatabase:recovery.restoredDatabase,
   twoPinnedKeysVerified:true,independentPeopleVerified:false,
   cloudCallsPermittedOnlyInManualStaging:true,
   realAwsServiceAccessAudited:false,
   liveSupabaseConnected:false,productionAuthorized:false
  });
 }
 return Object.freeze({execute});
}
