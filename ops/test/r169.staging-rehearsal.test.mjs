import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
import {r169GitHubOidcSubject,createR169IamPlan} from '../r169/iam-plan.mjs';
import {createR169StagingRehearsal,r169TargetDigest} from '../r169/staging-rehearsal.mjs';
const clock=()=>1800000000000,commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 archiveId='c'.repeat(32);
const sourceInventory={synthetic:true,pgRows:3};
const raw=Buffer.concat([Buffer.from('PGDMP'),randomBytes(2048)]);
const iam={accountId:'111122223333',region:'eu-west-1',bucketName:'marcosa-ci-locked',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
const iamExpected={...iam,expectedOidcSubject:r169GitHubOidcSubject(iam)};
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
 GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
 GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'44532123456',
 MARCOSA_STAGING_ONLY:'true',MARCOSA_REAL_AWS_OPT_IN:'true',
 AWS_EC2_METADATA_DISABLED:'true'};
function signed(){
 const reviewers=['operator','independent-reviewer'].map(role=>{
  const k=generateKeyPairSync('ed25519');
  return{role,privateKey:k.privateKey,
   publicKeyPem:k.publicKey.export({format:'pem',type:'spki'})};
 });
 const targetDigest=r169TargetDigest({
  commit,bundleSha256,sourceInventory,
  roleArn:'arn:aws:iam::111122223333:role/marcosa-staging-backup-role'});
 const packet=createR164DrillChallenge({
  commit,targetDigest,nonce:'e'.repeat(32),clock});
 return{packet,approvals:reviewers.map(x=>({
  role:x.role,publicKeyPem:x.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),x.privateKey)
   .toString('base64url')})),
  pinnedReviewerFingerprints:Object.fromEntries(reviewers.map(x=>[
   x.role,r164ReviewerFingerprint(x.publicKeyPem)]))};
}
function fixture({denyQuorum=false,failRestore=false,openGate=false,
 wrongRole=false,expiredPosture=false}={}){
 let nonceCalls=0,backupCalls=0,restoreCalls=0;
 const iamPlan=createR169IamPlan(iamExpected);
 const preflight={inspect:async()=>({
  passed:true,...{accountId:iam.accountId,region:iam.region,bucket:iam.bucketName,
   kmsKeyArn:iam.kmsKeyArn},checkedAtMs:clock(),expiresAtMs:clock()+60000,
  identityArn:'arn:aws:sts::111122223333:assumed-role/'+
   (wrongRole?'attacker':'marcosa-staging-backup-role')+'/ci-r169',
  objectLockCompliance:true,versioningEnabled:true,
  publicAccessBlocked:true,productionAuthorized:false
 })};
 const posture={inspect:async()=>({
  inspected:true,accountId:iam.accountId,region:iam.region,bucket:iam.bucketName,
  kmsKeyArn:iam.kmsKeyArn,
  checkedAtMs:clock(),expiresAtMs:clock()+(expiredPosture?-1:60000),
  bucketTlsDenyObserved:true,bucketNoPublicAllowObserved:true,
  defaultSseKmsVerified:true,ownerEnforcedVerified:true,
  kmsContextPolicyObserved:true,productionAuthorized:false
 })};
 const quarantine={status:async()=>({closed:!openGate,generation:5})};
 const durableQuorum={consume:async()=>{nonceCalls++;
  if(denyQuorum)throw Error('nonce replay');
  return{rehearsalLeaseRecorded:true,durablePostgresFence:true,
   nonce:'e'.repeat(32),productionAuthorized:false};
 }};
 const pipeline={
  async backup(){backupCalls++;
   return{remoteReceiptVerified:true,reference:{productionAuthorized:false,
    encryptedSha256:'f'.repeat(64),commit,bundleSha256,inventorySha256:'d'.repeat(64)}};},
  async rehearseRecovery(){restoreCalls++;
   if(failRestore)throw Error('restore failed');
   return{verified:true,restoredDatabase:'marcosa_r168_restored',
    productionAuthorized:false};
  }
 };
 const drill=createR169StagingRehearsal({
  iamPlan,iamExpected,preflight,posture,quarantine,durableQuorum,
  pipeline,clock,env
 });
 return{drill,counts:()=>({nonceCalls,backupCalls,restoreCalls})};
}
const request=()=>({commit,bundleSha256,archiveId,sourceInventory,
 plaintext:raw,...signed(),restoreIntoDisposableDatabase:async()=>{},
 readRestoredInventory:async()=>sourceInventory});
test('R169 signed manual-only AWS staging drill, durable nonce and quarantined isolated restore',async()=>{
 const x=fixture(),out=await x.drill.execute(request());
 assert.equal(out.verified,true);
 assert.equal(out.productionAuthorized,false);
 assert.equal(x.counts().nonceCalls,1);
 assert.equal(x.counts().backupCalls,1);
 assert.equal(x.counts().restoreCalls,1);
});
test('R169 fail-closed on wrong STS role, missing quorum, stale posture, opened SQL gate and failed restore',async()=>{
 for(const options of [
  {wrongRole:true},{denyQuorum:true},{expiredPosture:true},
  {openGate:true},{failRestore:true}
 ])await assert.rejects(fixture(options).drill.execute(request()),/R169|nonce replay/);
 const altered=request();altered.approvals=altered.approvals.slice(0,1);
 await assert.rejects(fixture().drill.execute(altered),/R164 quorum/);
});
