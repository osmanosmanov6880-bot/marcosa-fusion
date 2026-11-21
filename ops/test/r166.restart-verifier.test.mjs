import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR166SignedAnchor,r166AnchorFingerprint} from '../r166/signed-anchor.mjs';
import {createR166RestartVerifier} from '../r166/restart-verifier.mjs';
const t=1800000000000,commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 auditHead='0'.repeat(64),auditSeq=1,quarantineGeneration=3;
function fixture({open=false,nonceReplayed=true,writeBlocked=true}={}){
 const key=randomBytes(32);
 const sealed=sealR165Backup({plaintext:Buffer.concat([Buffer.from('PGDMP'),
  randomBytes(4096)]),key,commit,bundleSha256,createdAtMs:t});
 const encryptedSha256=sealed.encryptedSha256;
 const kp=generateKeyPairSync('ed25519');
 const anchorPublicKeyPem=kp.publicKey.export({type:'spki',format:'pem'});
 const signedAnchor=createR166SignedAnchor({privateKey:kp.privateKey,clock:()=>t,
  commit,bundleSha256,encryptedSha256,auditHead,auditSeq,quarantineGeneration});
 const record={seq:1,atMs:t,category:'quarantine_closed',outcome:'blocked',
  commit,prev:'0'.repeat(64)};
 // Valid hash-chained single entry is constructed below for the fixture:
 const {r166HashEntry}=requireHash();
 const head=r166HashEntry(record);
 const s=createR166SignedAnchor({privateKey:kp.privateKey,clock:()=>t,
  commit,bundleSha256,encryptedSha256,auditHead:head,auditSeq,quarantineGeneration});
 const snapshot={seq:1,head,entries:[{...record,hash:head}],productionAuthorized:false};
 const verifier=createR166RestartVerifier({
  audit:{snapshot:async()=>snapshot},
  quarantine:{status:async()=>({closed:!open,generation:quarantineGeneration})},
  quorum:{consume:async()=>{if(nonceReplayed)throw Error('signed nonce already consumed');return{accepted:true};}},
  store:{execute:async()=>{if(writeBlocked)throw Object.assign(
   Error('Operator quarantine closed'),{status:503});return{ok:true};}},
  vault:{readEncrypted:async()=>({sha256:encryptedSha256,
   bytes:sealed.blob,externalCopyVerified:false})},clock:()=>t
 });
 return{verifier,data:{signedAnchor:s,anchorPublicKeyPem,
  pinnedSpkiSha256:r166AnchorFingerprint(anchorPublicKeyPem),
  signedQuorum:{},mutation:{},key,commit,bundleSha256,encryptedSha256,
  auditHead:head,auditSeq,quarantineGeneration}};
}
import {r166HashEntry} from '../r166/audit-chain.mjs';
function requireHash(){return{r166HashEntry};}
test('R166 fresh-process verifier requires matching anchored head, replay rejection and closed gate',async()=>{
 const f=fixture(),proof=await f.verifier.verify(f.data);
 assert.equal(proof.verified,true);
 assert.equal(proof.postRestartNonceReplayRejected,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(proof.externalCopyVerified,false);
});
test('R166 denies reopened quarantine, missing nonce replay refusal, leaked mutation and wrong AES key',async()=>{
 for(const options of [{open:true},{nonceReplayed:false},{writeBlocked:false}]){
  const f=fixture(options);
  await assert.rejects(f.verifier.verify(f.data),/R166 restart/);
 }
 const f=fixture();
 await assert.rejects(f.verifier.verify({...f.data,key:randomBytes(32)}),
  /R165 encrypted archive/);
});
test('R166 wrong audit, new commit or false evidence cannot pass independent signed anchor',async()=>{
 const f=fixture();
 for(const changes of [{auditHead:'a'.repeat(64)},{commit:'c'.repeat(40)},
  {encryptedSha256:'c'.repeat(64)}])
  await assert.rejects(f.verifier.verify({...f.data,...changes}),
   /R166 signed anchor/);
});
