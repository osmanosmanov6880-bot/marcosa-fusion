import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
import {createR169IamPlan,r169GitHubOidcSubject} from '../r169/iam-plan.mjs';
import {createR170ReadOnlyStage,r170StageTargetDigest}
 from '../r170/read-only-stage.mjs';
const now=1800000000000,clock=()=>now,commit='a'.repeat(40),
 bundleSha256='b'.repeat(64),inventorySha256='f'.repeat(64);
const reference={sha256:'d'.repeat(64),versionId:'version-r170-01',
 archiveId:'c'.repeat(32),contextSha256:'e'.repeat(64),
 commit,bundleSha256};
const iamExpected={accountId:'111122223333',region:'eu-west-1',
 bucketName:'marcosa-ci-locked',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
 ownerId:340648536,repoId:1430301644,subjectMode:'legacy'};
iamExpected.expectedOidcSubject=r169GitHubOidcSubject(iamExpected);
const iamPlan=createR169IamPlan(iamExpected);
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
 GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
 GITHUB_SHA:commit,GITHUB_RUN_ID:'44556789123',GITHUB_EVENT_NAME:'workflow_dispatch',
 MARCOSA_STAGING_ONLY:'true',MARCOSA_REAL_AWS_OPT_IN:'true',
 AWS_EC2_METADATA_DISABLED:'true'};
function makeRequest(){
 const digest=r170StageTargetDigest({
  commit,bundleSha256,reference,inventorySha256,
  roleArn:iamPlan.AWS_ROLE_ARN
 });
 const keys=['operator','independent-reviewer'].map(role=>{
  const key=generateKeyPairSync('ed25519');
  return{role,privateKey:key.privateKey,
   publicKeyPem:key.publicKey.export({type:'spki',format:'pem'})};
 });
 const packet=createR164DrillChallenge({commit,targetDigest:digest,
  clock,nonce:'e'.repeat(32)});
 const approvals=keys.map(k=>({
  role:k.role,publicKeyPem:k.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),
   k.privateKey).toString('base64url')}));
 const pinnedReviewerFingerprints=Object.fromEntries(keys.map(k=>[
  k.role,r164ReviewerFingerprint(k.publicKeyPem)]));
 return{idToken:'sensitive-injected-token',commit,bundleSha256,
  reference,inventorySha256,packet,approvals,pinnedReviewerFingerprints};
}
function f({expiredIam=false,wrongSession=false,openGate=false,
 failNonce=false,weakRetention=false}={}){
 let closed=0,consumes=0,calls=0;
 const oidcExchange={
  roleArn:iamPlan.AWS_ROLE_ARN,exchange:async()=>{
   calls++;
   return{roleArn:iamPlan.AWS_ROLE_ARN,sessionArn:'arn:aws:sts::111122223333:assumed-role/marcosa-staging-backup-role/marcosa-r170-44556789123',
    awsStsResponseAccepted:true,credentials:{expiration:new Date(now+900000)},
    productionAuthorized:false};
  }};
 const scope={accountId:iamExpected.accountId,region:iamExpected.region,
  bucket:iamExpected.bucketName,kmsKeyArn:iamExpected.kmsKeyArn};
 const runtimeFactory=async()=>({
  close:async()=>{closed++;},
  preflight:{inspect:async()=>({
   passed:true,...scope,identityArn:wrongSession?'wrong':
    'arn:aws:sts::111122223333:assumed-role/marcosa-staging-backup-role/marcosa-r170-44556789123',
   objectLockCompliance:true,versioningEnabled:true,
   publicAccessBlocked:true,productionAuthorized:false,
   checkedAtMs:now,expiresAtMs:now+60000})},
  posture:{inspect:async()=>({
   inspected:true,...scope,checkedAtMs:now,expiresAtMs:now+60000,
   bucketTlsDenyObserved:true,bucketNoPublicAllowObserved:true,
   defaultSseKmsVerified:true,ownerEnforcedVerified:true,
   kmsContextPolicyObserved:true,productionAuthorized:false})},
  iam:{inspect:async()=>({checked:true,...scope,roleArn:iamPlan.AWS_ROLE_ARN,
   archiveSha256:reference.sha256,checks:expiredIam?0:13,
   allowed:7,denied:6,checkedAtMs:now,expiresAtMs:now+60000,
   roleResourcePolicySimulated:false,effectiveServiceAuthorizationEstablished:false,
   productionAuthorized:false})},
  retention:{inspect:async()=>({
   verified:true,sha256:reference.sha256,versionId:reference.versionId,
   bucket:scope.bucket,accountId:scope.accountId,kmsKeyArn:scope.kmsKeyArn,
   immutableVersionReadbackVerified:!weakRetention,aesGcmNotDecrypted:true,
   independentOffsiteAccountVerified:false,
   retainUntilMs:now+7*86400000,verifiedAtMs:now,expiresAtMs:now+60000,
   productionAuthorized:false})}
 });
 const quarantine={status:async()=>({closed:!openGate,generation:5})};
 const durableQuorum={consume:async()=>{consumes++;
  if(failNonce)throw Error('durable nonce already used');
  return{rehearsalLeaseRecorded:true,durablePostgresFence:true,
   nonce:'e'.repeat(32),productionAuthorized:false};
 }};
 const gate=createR170ReadOnlyStage({iamPlan,iamExpected,oidcExchange,
  runtimeFactory,quarantine,durableQuorum,env,clock});
 return{gate,counters:()=>({closed,consumes,calls})};
}
test('R170 one-use manual stage integrates signed source, STS, IAM, S3 readback and closed quarantine',async()=>{
 const x=f(),res=await x.gate.verify(makeRequest());
 assert.equal(res.verified,true);
 assert.equal(res.productionAuthorized,false);
 assert.equal(res.iamCanariesPassed,13);
 assert.deepEqual(x.counters(),{closed:1,consumes:1,calls:1});
 assert.equal(JSON.stringify(res).includes('sensitive'),false);
});
test('R170 fail-closed IAM drift, session substitution, stale S3 or nonce, SQL open quarantine',async()=>{
 for(const option of [
  {expiredIam:true},{wrongSession:true},{openGate:true},
  {failNonce:true},{weakRetention:true}
 ]){
  const x=f(option);
  await assert.rejects(x.gate.verify(makeRequest()),/R170 read-only stage/);
 }
 const x=f(),q=makeRequest();
 q.approvals=q.approvals.slice(0,1);
 await assert.rejects(x.gate.verify(q),/R164 quorum/);
 assert.equal(x.counters().calls,0);
});
