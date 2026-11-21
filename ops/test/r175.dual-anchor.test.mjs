import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {issueR175DualAnchor,verifyR175DualAnchor}
 from '../r175/dual-anchor.mjs';
const op=generateKeyPairSync('ed25519'),review=generateKeyPairSync('ed25519');
const clock=()=>1800000000000;
const data={sequence:1,commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),
 archiveSha256:'c'.repeat(64),escrowSha256:'d'.repeat(64),
 checkpointSha256:'e'.repeat(64),priorAnchorSha256:'0'.repeat(64)};
function signed(){return issueR175DualAnchor({
 data,operatorKey:op.privateKey,reviewerKey:review.privateKey,clock});}
function opts(receipt=signed()){return{receipt,
 pinnedOperatorSpkiSha256:receipt.approvals[0].signerSpkiSha256,
 pinnedReviewerSpkiSha256:receipt.approvals[1].signerSpkiSha256,
 ...data,clock};}
test('R175 requires two distinct pinned Ed25519 signatures, exact SHA and no production authority',()=>{
 const proof=verifyR175DualAnchor(opts());
 assert.equal(proof.verified,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(proof.realHumanApprovalVerified,false);
 assert.equal(proof.anchorSha256.length,64);
 assert.throws(()=>issueR175DualAnchor({data,
  operatorKey:op.privateKey,reviewerKey:op.privateKey,clock}),
  /R175 dual anchor/);
});
test('R175 rejects forged key, replaced sequence, expired proof and broken parent hash',()=>{
 const receipt=signed();
 for(const changed of [
  {receipt:{...receipt,manifest:{...receipt.manifest,archiveSha256:'f'.repeat(64)}}},
  {receipt:{...receipt,approvals:[receipt.approvals[0],receipt.approvals[0]]}},
  {sequence:2},{priorAnchorSha256:'1'.repeat(64)},
  {pinnedReviewerSpkiSha256:'f'.repeat(64)},
  {clock:()=>1800000000000+8*86400000}
 ])assert.throws(()=>verifyR175DualAnchor({...opts(receipt),...changed}),
  /R175 dual anchor/);
});
test('R175 refuses first checkpoint with non-genesis predecessor',()=>{
 assert.throws(()=>issueR175DualAnchor({
  data:{...data,priorAnchorSha256:'f'.repeat(64)},
  operatorKey:op.privateKey,reviewerKey:review.privateKey,clock
 }),/R175 dual anchor/);
});
