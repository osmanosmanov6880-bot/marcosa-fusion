/**
 * R166 restart verifier: run in a new Node process with fresh PG connections.
 * It accepts only complete signed offline evidence, verifies the same durable
 * PostgreSQL audit head, rejects nonce replays and new writes after closure,
 * then decrypts an archived synthetic backup from private filesystem.
 * Never opens quarantine or authorizes production.
 */
import {verifyR166SignedAnchor} from './signed-anchor.mjs';
import {verifyR166Snapshot} from './audit-chain.mjs';
import {openR165Backup} from '../r165/encrypted-backup.mjs';

const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R166 restart: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function createR166RestartVerifier({audit,quarantine,quorum,store,vault,
 clock=()=>Date.now()}={}){
 ok(audit&&typeof audit.snapshot==='function'&&
  quarantine&&typeof quarantine.status==='function'&&
  quorum&&typeof quorum.consume==='function'&&
  store&&typeof store.execute==='function'&&
  vault&&typeof vault.readEncrypted==='function'&&
  typeof clock==='function','trusted independent readback components required');
 return Object.freeze({
  async verify({signedAnchor,anchorPublicKeyPem,pinnedSpkiSha256,
   signedQuorum,mutation,key,commit,bundleSha256,encryptedSha256,
   auditHead,auditSeq,quarantineGeneration}={}){
   ok(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
    H64.test(encryptedSha256||'')&&H64.test(auditHead||'')&&
    Number.isSafeInteger(auditSeq)&&auditSeq>=1&&
    Number.isSafeInteger(quarantineGeneration)&&quarantineGeneration>=3,
    'expected complete independent evidence required');
   const signed=verifyR166SignedAnchor({
    receipt:signedAnchor,publicKeyPem:anchorPublicKeyPem,pinnedSpkiSha256,
    commit,bundleSha256,encryptedSha256,auditHead,auditSeq,
    quarantineGeneration,clock});
   ok(signed.verified&&signed.productionAuthorized===false,
    'independent reviewer key verification missing');
   const snap=await audit.snapshot();
   const verified=verifyR166Snapshot(snap,{commit,expectedHead:auditHead});
   ok(verified.matched&&verified.events===auditSeq,
    'PostgreSQL incident head changed after restart');
   const gate=await quarantine.status();
   ok(gate.closed===true&&gate.generation===quarantineGeneration,
    'persistent quarantine must remain closed after restart');
   let nonceRejected=false;
   try{await quorum.consume(signedQuorum);}
   catch(e){nonceRejected=typeof e?.message==='string'&&
    e.message.includes('signed nonce already consumed');}
   ok(nonceRejected,'signed nonce replay did not fail as an existing durable replay');
   let writeRejected=false;
   try{await store.execute(mutation);}
   catch(e){writeRejected=e?.status===503&&
    /quarantine/i.test(String(e.message||''));}
   ok(writeRejected,'closed durable quarantine did not reject a fresh mutation');
   const blob=await vault.readEncrypted({sha256:encryptedSha256});
   ok(blob.sha256===encryptedSha256&&
    blob.externalCopyVerified===false&&
    Buffer.isBuffer(blob.bytes),
    'no acceptable encrypted local readback');
   // The source-bound R165 AES-GCM tag is independently rechecked in this
   // fresh process. Plaintext is never emitted, written or returned.
   const open=openR165Backup({blob:blob.bytes,key,commit,bundleSha256,now:clock()});
   ok(open.verified&&open.productionAuthorized===false,
    'AES-GCM source-bound backup authentication failed');
   open.plaintext.fill(0);
   return Object.freeze({verified:true,postRestartNonceReplayRejected:true,
    quarantinePersistedClosed:true,auditHeadAnchored:true,
    signedIndependentKeyPinned:true,localEncryptedReadback:true,
    externalCopyVerified:false,liveSupabaseConnected:false,
    productionAuthorized:false,paymentsEnabled:false,payoutsEnabled:false});
  }
 });
}
