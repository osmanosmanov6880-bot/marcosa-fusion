import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealR165Backup,openR165Backup} from '../r165/encrypted-backup.mjs';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const fixture=()=>({plaintext:Buffer.concat([Buffer.from('PGDMP'),randomBytes(4096)]),
 key:randomBytes(32),commit,bundleSha256});
test('R165 authenticated backup preserves exact bytes, digest and source binding',()=>{
 const f=fixture(),sealed=sealR165Backup(f);
 const restored=openR165Backup({...f,blob:sealed.blob});
 assert.equal(restored.verified,true);
 assert.ok(restored.plaintext.equals(f.plaintext));
 assert.equal(restored.archiveSha256,sealed.plaintextSha256);
 assert.equal(restored.productionAuthorized,false);
 assert.equal(sealed.offsiteCopyVerified,false);
 assert.equal(sealed.blob.includes(f.plaintext),false);
 const other=sealR165Backup(f);
 assert.notEqual(other.encryptedSha256,sealed.encryptedSha256);
});
test('R165 refuses wrong AES key, changed release identity and tampered ciphertext',()=>{
 const f=fixture(),sealed=sealR165Backup(f);
 const tampered=Buffer.from(sealed.blob);tampered[tampered.length-17]^=1;
 const headerTamper=Buffer.from(sealed.blob);headerTamper[headerTamper.indexOf('synthetic-ci-only')]=33;
 for(const args of [{...f,key:randomBytes(32),blob:sealed.blob},
  {...f,blob:sealed.blob,commit:'c'.repeat(40)},
  {...f,blob:tampered},{...f,blob:headerTamper},
  {...f,blob:sealed.blob.subarray(0,sealed.blob.length-1)}])
  assert.throws(()=>openR165Backup(args),/R165 encrypted archive/);
});
test('R165 rejects weak keys, unknown production scope and expired archives',()=>{
 const f=fixture();
 assert.throws(()=>sealR165Backup({...f,key:Buffer.alloc(16)}),/32-byte key/);
 assert.throws(()=>sealR165Backup({...f,commit:'test'}),/synthetic/);
 const sealed=sealR165Backup({...f,createdAtMs:1800000000000});
 assert.throws(()=>openR165Backup({...f,blob:sealed.blob,now:1800007200000}),
  /expired/);
});
