import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createR163ReviewChallenge,verifyR163ReviewAttestation,
 reviewerKeyFingerprint,r163ReviewCanonicalBytes} from '../r163/review-attestation.mjs';
const sha='a'.repeat(40),bundleSha256='b'.repeat(64);
const now=1800000000000;
function setup(){
 const reviewer=generateKeyPairSync('ed25519');
 const builder=generateKeyPairSync('ed25519');
 const challenge=createR163ReviewChallenge({commit:sha,bundleSha256,
  clock:()=>now,nonce:'c'.repeat(32)});
 const signature=sign(null,r163ReviewCanonicalBytes(challenge),
  reviewer.privateKey).toString('base64url');
 return{reviewer,builder,challenge,signature,
  args:{challenge,signature,reviewerPublicKey:reviewer.publicKey,
   reviewerPin:reviewerKeyFingerprint(reviewer.publicKey),
   builderPin:reviewerKeyFingerprint(builder.publicKey),
   commit:sha,bundleSha256,clock:()=>now}};
}
test('R163 separate Ed25519 reviewer signs exact staging SHA without production authorization',()=>{
 const t=setup(),p=verifyR163ReviewAttestation(t.args);
 assert.equal(p.cryptographicSignatureVerified,true);
 assert.equal(p.stagingReviewArtifactVerified,true);
 assert.equal(p.productionAuthorized,false);
 assert.equal(p.humanIndependenceEstablished,false);
 assert.equal(p.commercialPaymentsEnabled,false);
});
test('R163 forged key pin, builder-as-reviewer and changed payload rejected',()=>{
 const t=setup();
 for(const x of [
  {reviewerPin:'f'.repeat(64)},
  {builderPin:t.args.reviewerPin},
  {commit:'d'.repeat(40)},
  {bundleSha256:'e'.repeat(64)},
  {signature:'A'.repeat(86)},
  {reviewerPublicKey:generateKeyPairSync('ed25519').publicKey}
 ]){
  assert.throws(()=>verifyR163ReviewAttestation({...t.args,...x}),/R163 attestation/);
 }
 assert.throws(()=>verifyR163ReviewAttestation({...t.args,
  challenge:{...t.challenge,reviewResult:'production-approved'}}),/R163 attestation/);
 assert.throws(()=>verifyR163ReviewAttestation({...t.args,
  challenge:{...t.challenge,secret:'something'}}),/exact review payload/);
});
test('R163 stale, future and over-long reviews denied',()=>{
 const t=setup();
 for(const ch of [
  {...t.challenge,issuedAtMs:now+40000,expiresAtMs:now+100000},
  {...t.challenge,expiresAtMs:now-1},
  {...t.challenge,expiresAtMs:now+900001},
  {...t.challenge,nonce:'nothex'}
 ]){
  assert.throws(()=>verifyR163ReviewAttestation({...t.args,challenge:ch}),
   /R163 attestation/);
 }
});
