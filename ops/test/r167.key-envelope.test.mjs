import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {wrapR167DataKey,unwrapR167DataKey,r167RecipientFingerprint,
 r167SyntheticCiRecipient} from '../r167/key-envelope.mjs';
const sourceCommit='a'.repeat(40),bundleSha256='b'.repeat(64),
 ciphertextSha256='c'.repeat(64),time=1800000000000;
function f(){
 const k=generateKeyPairSync('x25519'),dataKey=randomBytes(32),
  pinnedRecipientSpkiSha256=r167RecipientFingerprint(k.publicKey);
 const source={sourceCommit,bundleSha256,ciphertextSha256};
 const wrapped=wrapR167DataKey({...source,dataKey,recipientPublicKey:k.publicKey,
  pinnedRecipientSpkiSha256,keyEpoch:7,clock:()=>time});
 return{k,source,dataKey,pinnedRecipientSpkiSha256,wrapped};
}
test('R167 envelope only pinned X25519 recipient can unwrap exact source-bound AES key',()=>{
 const x=f();
 const recovered=unwrapR167DataKey({envelope:x.wrapped,recipientPrivateKey:x.k.privateKey,
  ...x.source,pinnedRecipientSpkiSha256:x.pinnedRecipientSpkiSha256,
  minimumKeyEpoch:7,clock:()=>time});
 assert.ok(recovered.equals(x.dataKey));recovered.fill(0);
 assert.equal(x.wrapped.productionAuthorized,false);
 assert.equal('dataKey' in x.wrapped,false);
});
test('R167 wrong identity, tamper, replayed epoch, expiry and extra field fail closed',()=>{
 const x=f(),other=generateKeyPairSync('x25519');
 const args={envelope:x.wrapped,recipientPrivateKey:x.k.privateKey,
  ...x.source,pinnedRecipientSpkiSha256:x.pinnedRecipientSpkiSha256,
  minimumKeyEpoch:7,clock:()=>time};
 for(const item of [
  {...args,recipientPrivateKey:other.privateKey},
  {...args,minimumKeyEpoch:8},
  {...args,clock:()=>time+4000000},
  {...args,sourceCommit:'d'.repeat(40)},
  {...args,envelope:{...x.wrapped,extra:'ignored'}},
  {...args,envelope:{...x.wrapped,authTag:'0'.repeat(32)}},
  {...args,envelope:{...x.wrapped,expiresAtMs:x.wrapped.expiresAtMs+1}}
 ])assert.throws(()=>unwrapR167DataKey(item),/R167 envelope/);
});
test('R167 deterministic CI-only private key is explicit, reproducible and NOT secure KMS',()=>{
 const x=r167SyntheticCiRecipient({sourceCommit}),y=r167SyntheticCiRecipient({sourceCommit});
 assert.equal(x.pinnedSpkiSha256,y.pinnedSpkiSha256);
 assert.equal(x.publiclyDerivableTestKey,true);
 assert.equal(x.externalKmsVerified,false);
 assert.equal(x.productionAuthorized,false);
 assert.notEqual(x.pinnedSpkiSha256,r167SyntheticCiRecipient({sourceCommit,epoch:2}).pinnedSpkiSha256);
});
