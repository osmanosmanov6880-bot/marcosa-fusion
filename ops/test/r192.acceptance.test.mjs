import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildR192Fixture} from '../r192/ci-fixture.mjs';
import {assessR192ReviewDecision} from '../r192/review-decision.mjs';
import {assessR192AwsRisk} from '../r192/aws-risk.mjs';
import {verifyR192KeyRotation} from '../r192/key-rotation.mjs';
import {assessR192Release,R192_NO_GO} from '../r192/release-verdict.mjs';
import {r192NativeHoldSql,createR192NativeLedger} from '../r192/native-ledger.mjs';
import {sealReceipt} from '../r190/common.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const now=Date.now(),commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const args={commit,bundleSha256},clock=()=>now;
test('R192 review decision rejects stale, missing and unsanctioned reviewers',()=>{
 const f=buildR192Fixture({...args,now});
 assert.equal(f.review.reviewerCount,3);
 assert.equal(f.review.productionAuthorized,false);
 assert.deepEqual(f.review.blockers,['NATURAL_PERSON_IDENTITIES_NOT_INDEPENDENTLY_ATTESTED']);
 const partial=buildR192Fixture({...args,now,missingReview:'SECURITY'});
 assert.ok(partial.review.blockers.includes('MISSING_SECURITY_REVIEW'));
 assert.equal(partial.review.githubQuorumClaim,false);
 assert.throws(()=>assessR192ReviewDecision({...args,
  github:f.github,clock:()=>now+62000}),/expired/);
 const altered={...f.github,commitSignatureVerifiedByGithub:false};
 assert.throws(()=>assessR192ReviewDecision({...args,github:altered,clock}),/tampered/);
});
test('R192 genuine three-Ed25519 approval protects single-key rotation and replay',()=>{
 const f=buildR192Fixture({...args,now});
 const options={oldBytes:f.oldBytes,newBytes:f.newBytes,
  expectedOldSha256:f.oldRegistrySha256,bundleSha256,
  challenge:f.challenge,signatures:f.signatures,clock};
 assert.equal(verifyR192KeyRotation(options).verifiedOldSignerCount,3);
 assert.equal(f.rotation.newGeneration,9);
 assert.equal(f.rotation.actualRotations,1);
 assert.equal(f.rotation.productionAuthorized,false);
 assert.throws(()=>verifyR192KeyRotation({...options,
  expectedOldSha256:'0'.repeat(64)}),/external trust pin/);
 assert.throws(()=>verifyR192KeyRotation({...options,
  clock:()=>now+46000}),/expired/);
 const bad=f.signatures.map(r=>({...r}));
 bad[1].signatureBase64url='A'.repeat(86);
 assert.throws(()=>verifyR192KeyRotation({...options,signatures:bad}),/signature/);
 const newer=JSON.parse(f.newBytes.toString('utf8'));
 newer.reviewers[0]=newer.reviewers[2];
 const newBytes=Buffer.from(JSON.stringify(newer)+'\n');
 assert.throws(()=>verifyR192KeyRotation({...options,newBytes}),/key|identity|role|challenge/);
});
test('R192 AWS classifier distinguishes 24 simulated deny from actual AWS policy rights',()=>{
 const f=buildR192Fixture({...args,now});
 assert.equal(f.iamRisk.simulatedActions,24);
 assert.equal(f.iamRisk.simulatedDenied,24);
 assert.equal(f.iamRisk.dangerousActionSimulationAllDenied,true);
 assert.equal(f.iamRisk.awsEffectiveRightsIndependentlyVerified,false);
 const weakened=buildR192Fixture({...args,now,awsAllowed:'s3:DeleteObject'});
 assert.equal(weakened.iamRisk.dangerousActionSimulationAllDenied,false);
 assert.ok(weakened.iamRisk.blockers.includes('SOURCE_DESTRUCTIVE_IAM_ACTION_NOT_DENIED'));
 const tampered={...f.iam,all24DangerousActionsDenied:false};
 assert.throws(()=>assessR192AwsRisk({...args,iam:tampered,clock}),/tampered/);
 assert.throws(()=>assessR192AwsRisk({...args,iam:f.iam,
  clock:()=>now+62000}),/expired/);
});
test('R192 final release produces executable human handoff blockers with hard NO-GO',()=>{
 const f=buildR192Fixture({...args,now});
 assert.equal(f.release.decision,R192_NO_GO);
 assert.equal(f.release.operatorHandoffRequired,true);
 assert.equal(f.release.productionAuthorized,false);
 assert.equal(f.release.remediation.length,f.release.blockers.length);
 assert.equal(new Set(f.release.blockers).size,f.release.blockers.length);
 assert.ok(f.release.blockers.includes('LIVE_STAGING_RECOVERY_NOT_MEASURED'));
 const fake={...f.rotation,actualRotations:2};
 assert.throws(()=>assessR192Release({...args,parentR191Commit:f.release.parentR191Commit,
  review:f.review,rotation:fake,iamRisk:f.iamRisk,clock}),/tampered/);
});
test('R192 SQL enforces serializable, RLS, no-GO and replay refusal in append-only ledger',async()=>{
 const f=buildR192Fixture({...args,now});
 const packet={sourceCommit:commit,parentR191Commit:f.release.parentR191Commit,
  sourceBundleSha256:bundleSha256,reviewEvidenceSha256:f.review.evidenceSha256,
  iamRiskEvidenceSha256:f.iamRisk.evidenceSha256,
  rotationEvidenceSha256:f.rotation.evidenceSha256,
  releaseEvidenceSha256:f.release.evidenceSha256,
  decision:R192_NO_GO,sourceMode:'CI_DISPOSABLE',productionAuthorized:false};
 const sql=r192NativeHoldSql(packet);
 for(const token of ['SERIALIZABLE','marcosa_r192_writer',
  'r192_ci.release_holds','r192_ci.release_audit','ON CONFLICT DO NOTHING'])
  assert.ok(sql.includes(token),token);
 for(const mutation of [{productionAuthorized:true},{decision:'GO'},
  {sourceMode:'LIVE_PROD'},{releaseEvidenceSha256:'bad'}])
  assert.throws(()=>r192NativeHoldSql({...packet,...mutation}),/synthetic source/);
 let attempts=0;
 const ledger=createR192NativeLedger({
  executeSql:async()=>attempts++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'});
 assert.equal((await ledger.append(packet)).recorded,true);
 await assert.rejects(ledger.append(packet),/replay or partial/);
 assert.equal(sha(f.bytes),f.fileSha256);
});
