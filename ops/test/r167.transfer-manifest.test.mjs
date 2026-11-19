import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createR167TransferManifest,verifyR167TransferManifest,
 verifyR167RestoredInventory} from '../r167/transfer-manifest.mjs';
const time=1800000000000, sourceCommit='a'.repeat(40),bundleSha256='b'.repeat(64),
 ciphertextSha256='c'.repeat(64),recipientSpkiSha256='d'.repeat(64);
const inventory=()=>({
 auditHead:'a'.repeat(64),auditRows:3,quarantineClosed:true,
 quarantineGeneration:5,publicRows:3,privateRows:2,
 activeSessions:1,revokedSessions:1,privateRls:true,publicRls:true,
 browserCanReadPrivate:false,readerCanReadPrivate:true,
 writerCanDeleteAudit:false,rowsDigest:'e'.repeat(64)
});
function f(){
 const key=generateKeyPairSync('ed25519');
 const envelope={type:'test-key-envelope',nonce:'v1'};
 const receipt=createR167TransferManifest({sourceCommit,bundleSha256,
  ciphertextSha256,ciphertextBytes:1234,envelope,recipientSpkiSha256,
  sourceInventory:inventory(),privateKey:key.privateKey,clock:()=>time});
 const expectedSignerSpkiSha256=receipt.signerSpkiSha256;
 return{receipt,envelope,expectedCommit:sourceCommit,expectedBundleSha256:bundleSha256,
  expectedCiphertextSha256:ciphertextSha256,
  expectedRecipientSpkiSha256:recipientSpkiSha256,expectedSignerSpkiSha256,
  clock:()=>time};
}
test('R167 authentic source signed transfer manifest and strict restored RLS parity',()=>{
 const a=f(),p=verifyR167TransferManifest(a);
 assert.equal(p.verified,true);
 assert.equal(p.productionAuthorized,false);
 assert.equal(verifyR167RestoredInventory({source:inventory(),restored:inventory()}).verified,true);
});
test('R167 tampered source, damaged signature, missing separate signer pin, corrupt inventory reject',()=>{
 const a=f();
 for(const change of [
  {expectedCiphertextSha256:'0'.repeat(64)},
  {expectedRecipientSpkiSha256:'0'.repeat(64)},
  {expectedSignerSpkiSha256:'0'.repeat(64)},
  {envelope:{...a.envelope,changed:true}},
  {clock:()=>time+5000000},
  {receipt:{...a.receipt,signature:'0'.repeat(86)}},
  {receipt:{...a.receipt,manifest:{...a.receipt.manifest,productionAuthorized:true}}}
 ])assert.throws(()=>verifyR167TransferManifest({...a,...change}),/R167 transfer manifest/);
 assert.throws(()=>verifyR167RestoredInventory({
  source:inventory(),restored:{...inventory(),quarantineClosed:false}}),
  /R167 transfer manifest/);
 assert.throws(()=>verifyR167RestoredInventory({
  source:inventory(),restored:{...inventory(),rowsDigest:'0'.repeat(64)}}),
  /R167 transfer manifest/);
});
