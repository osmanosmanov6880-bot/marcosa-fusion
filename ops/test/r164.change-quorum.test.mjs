import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createR164DrillChallenge,verifyR164DualReview,createR164NonceFence,
 r164CanonicalChallengeBytes,r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
const time=1800000000000,commit='a'.repeat(40),targetDigest='b'.repeat(64);
function fixture(){
 const operator=generateKeyPairSync('ed25519');
 const reviewer=generateKeyPairSync('ed25519');
 const packet=createR164DrillChallenge({commit,targetDigest,clock:()=>time,
  nonce:'f'.repeat(32)});
 const approve=(role,key)=>({role,
  publicKeyPem:key.publicKey.export({format:'pem',type:'spki'}),
  signature:sign(null,r164CanonicalChallengeBytes(packet),key.privateKey)
   .toString('base64url')});
 const approvals=[approve('operator',operator),approve('independent-reviewer',reviewer)];
 const pins={operator:r164ReviewerFingerprint(approvals[0].publicKeyPem),
  'independent-reviewer':r164ReviewerFingerprint(approvals[1].publicKeyPem)};
 return{operator,reviewer,packet,approvals,pins,opts:{packet,approvals,
  pinnedReviewerFingerprints:pins,commit,targetDigest,clock:()=>time}};
}
test('R164 dual out-of-band pinned Ed25519 signatures authorize one synthetic DRILL, never deploy',()=>{
 const f=fixture(),verified=verifyR164DualReview(f.opts);
 assert.equal(verified.signatureCount,2);
 assert.equal(verified.productionAuthorized,false);
 assert.equal(verified.humanSeparationVerified,false);
 const fence=createR164NonceFence({clock:()=>time});
 assert.equal(fence.consume(verified).rehearsalPermitted,true);
 assert.throws(()=>fence.consume(verified),/reused nonce/);
 assert.equal(fence.status().durableReplayProtection,false);
});
test('R164 reject builder=reviewer, tampered source, stale, role duplicate, bad signature and extra keys',()=>{
 const f=fixture();
 const changes=[
  {pinnedReviewerFingerprints:{...f.pins,'independent-reviewer':f.pins.operator}},
  {commit:'0'.repeat(40)},
  {targetDigest:'0'.repeat(64)},
  {approvals:[f.approvals[0],f.approvals[0]]},
  {approvals:[f.approvals[0],{...f.approvals[1],signature:'A'.repeat(86)}]},
  {packet:{...f.packet,extra:'unsafe'}},
  {clock:()=>time+300001}
 ];
 for(const edit of changes)
  assert.throws(()=>verifyR164DualReview({...f.opts,...edit}),/R164 quorum/);
});
test('R164 real staging review cannot be consumed as CI-only authorization',()=>{
 const f=fixture();
 const realPacket={...f.packet,synthetic:false};
 const realApprovals=f.approvals.map(e=>({...e,signature:sign(null,
  r164CanonicalChallengeBytes(realPacket),
  (e.role==='operator'?f.operator:f.reviewer).privateKey).toString('base64url')}));
 const reviewed=verifyR164DualReview({...f.opts,packet:realPacket,
  approvals:realApprovals});
 assert.equal(reviewed.productionAuthorized,false);
 assert.throws(()=>createR164NonceFence({clock:()=>time}).consume(reviewed),/only fresh synthetic/);
 const fence=createR164NonceFence({clock:()=>time,maxUses:1});
 const verified=verifyR164DualReview(f.opts);fence.consume(verified);
 assert.throws(()=>fence.consume({...verified,nonce:'0'.repeat(32)}),/exhausted/);
 fence.close();assert.throws(()=>fence.consume(verified),/closed/);
});
