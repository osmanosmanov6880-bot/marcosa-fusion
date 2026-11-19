import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createR166SignedAnchor,verifyR166SignedAnchor,
 r166AnchorFingerprint} from '../r166/signed-anchor.mjs';
const t=1800000000000,commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 encryptedSha256='c'.repeat(64),auditHead='d'.repeat(64),auditSeq=3,
 quarantineGeneration=3;
function fixture(){
 const kp=generateKeyPairSync('ed25519'),
  publicKeyPem=kp.publicKey.export({format:'pem',type:'spki'});
 const evidence={commit,bundleSha256,encryptedSha256,auditHead,auditSeq,
  quarantineGeneration};
 const receipt=createR166SignedAnchor({...evidence,privateKey:kp.privateKey,
  clock:()=>t,nonce:'e'.repeat(32)});
 const pinnedSpkiSha256=r166AnchorFingerprint(publicKeyPem);
 return{evidence,receipt,publicKeyPem,pinnedSpkiSha256,
  clock:()=>t,privateKey:kp.privateKey};
}
test('R166 Ed25519 reviewer pins exact encrypted archive, database head and commit',()=>{
 const f=fixture(),proof=verifyR166SignedAnchor({...f,...f.evidence});
 assert.equal(proof.verified,true);assert.equal(proof.reviewKeyPinned,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(proof.externalSignerHumanVerified,false);
 assert.match(proof.receiptSha256,/^[a-f0-9]{64}$/);
});
test('R166 signature, pinned reviewer, head, archive, expiry and injected fields fail closed',()=>{
 const f=fixture(),another=generateKeyPairSync('ed25519').publicKey
  .export({format:'pem',type:'spki'});
 const cases=[
  {...f.evidence,auditHead:'0'.repeat(64)},
  {...f.evidence,encryptedSha256:'0'.repeat(64)},
  {...f.evidence,commit:'0'.repeat(40)}
 ];
 for(const change of cases)assert.throws(()=>verifyR166SignedAnchor({
  ...f,...change}),/R166 signed anchor/);
 assert.throws(()=>verifyR166SignedAnchor({...f,...f.evidence,
  publicKeyPem:another}),/review key not independently pinned/);
 assert.throws(()=>verifyR166SignedAnchor({...f,...f.evidence,
  clock:()=>t+700000}),/expired/);
 assert.throws(()=>verifyR166SignedAnchor({...f,...f.evidence,
  receipt:{...f.receipt,productionAuthorized:true}}),/exact offline/);
 assert.throws(()=>verifyR166SignedAnchor({...f,...f.evidence,
  receipt:{...f.receipt,packet:{...f.receipt.packet,extra:'unsafe'}}}),/exact source/);
});
