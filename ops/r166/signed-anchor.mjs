/**
 * R166 independently pinned Ed25519 evidence anchor.
 * Signing key is injected by operator and never generated, exported or stored.
 * A separate key PIN proves key continuity, not human independence.
 */
import {createHash,createPublicKey,createPrivateKey,randomBytes,
 sign as signEd,verify as verifyEd,timingSafeEqual} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion',H40=/^[a-f0-9]{40}$/,
 H64=/^[a-f0-9]{64}$/,N32=/^[a-f0-9]{32}$/;
const allowed=['schemaVersion','repository','commit','bundleSha256','encryptedSha256',
 'auditHead','auditSeq','quarantineGeneration','nonce','issuedAtMs','expiresAtMs',
 'scope','productionAuthorized'].sort().join(',');
const error=m=>{throw Error('R166 signed anchor: '+m);};
const ok=(v,m)=>{if(!v)error(m);};
const canonical=p=>Buffer.from(JSON.stringify({
 schemaVersion:1,repository:REPO,commit:p.commit,
 bundleSha256:p.bundleSha256,encryptedSha256:p.encryptedSha256,
 auditHead:p.auditHead,auditSeq:p.auditSeq,
 quarantineGeneration:p.quarantineGeneration,nonce:p.nonce,
 issuedAtMs:p.issuedAtMs,expiresAtMs:p.expiresAtMs,
 scope:'isolated-staging-evidence',productionAuthorized:false
}));
export function r166AnchorFingerprint(publicKeyPem){
 ok(typeof publicKeyPem==='string'&&publicKeyPem.length<2000,'bounded public key required');
 const key=createPublicKey(publicKeyPem);
 ok(key.asymmetricKeyType==='ed25519','public Ed25519 key required');
 return createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
}
function checkPacket(p,now){
 ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
  Object.keys(p).sort().join(',')===allowed,
  'exact source-bound evidence packet required');
 ok(p.schemaVersion===1&&p.repository===REPO&&H40.test(p.commit||'')&&
  H64.test(p.bundleSha256||'')&&H64.test(p.encryptedSha256||'')&&
  H64.test(p.auditHead||'')&&
  Number.isSafeInteger(p.auditSeq)&&p.auditSeq>=1&&p.auditSeq<=256&&
  Number.isSafeInteger(p.quarantineGeneration)&&p.quarantineGeneration>=3&&
  N32.test(p.nonce||'')&&p.scope==='isolated-staging-evidence'&&
  p.productionAuthorized===false,'bounded exact source, audit and quarantine identity required');
 ok(Number.isSafeInteger(now)&&Number.isSafeInteger(p.issuedAtMs)&&
  Number.isSafeInteger(p.expiresAtMs)&&p.issuedAtMs>0&&
  p.issuedAtMs<=now+15000&&now<=p.expiresAtMs&&
  p.expiresAtMs>p.issuedAtMs&&p.expiresAtMs-p.issuedAtMs<=900000,
  'expired or excessively long review anchor');
}
export function createR166SignedAnchor({commit,bundleSha256,encryptedSha256,
 auditHead,auditSeq,quarantineGeneration,privateKey,
 clock=()=>Date.now(),nonce=randomBytes(16).toString('hex')}={}){
 ok(typeof clock==='function','review clock required');
 const time=clock();
 const packet={schemaVersion:1,repository:REPO,commit,bundleSha256,encryptedSha256,
  auditHead,auditSeq,quarantineGeneration,nonce,issuedAtMs:time,
  expiresAtMs:time+600000,scope:'isolated-staging-evidence',productionAuthorized:false};
 checkPacket(packet,time);
 let key;
 try{key=privateKey?.type==='private'?privateKey:createPrivateKey(privateKey);}
 catch{error('external private Ed25519 key required');}
 ok(key.asymmetricKeyType==='ed25519','Ed25519 signing key required');
 const signature=signEd(null,canonical(packet),key).toString('base64url');
 return Object.freeze({packet:Object.freeze(packet),signature,
  productionAuthorized:false,externalSignerHumanVerified:false});
}
export function verifyR166SignedAnchor({receipt,publicKeyPem,pinnedSpkiSha256,
 commit,bundleSha256,encryptedSha256,auditHead,auditSeq,
 quarantineGeneration,clock=()=>Date.now()}={}){
 ok(typeof clock==='function','trusted clock required');
 ok(receipt&&Object.getPrototypeOf(receipt)===Object.prototype&&
  Object.keys(receipt).sort().join(',')===
   'externalSignerHumanVerified,packet,productionAuthorized,signature'&&
  receipt.productionAuthorized===false&&receipt.externalSignerHumanVerified===false,
  'exact offline review receipt required');
 checkPacket(receipt.packet,clock());
 const p=receipt.packet;
 ok(p.commit===commit&&p.bundleSha256===bundleSha256&&
  p.encryptedSha256===encryptedSha256&&p.auditHead===auditHead&&
  p.auditSeq===auditSeq&&p.quarantineGeneration===quarantineGeneration,
  'sealed source, audit or quarantine identity differs');
 ok(H64.test(pinnedSpkiSha256||'')&&
  typeof receipt.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(receipt.signature),
  'out-of-band SPKI pin and Ed25519 signature required');
 const fp=r166AnchorFingerprint(publicKeyPem);
 ok(timingSafeEqual(Buffer.from(fp,'hex'),Buffer.from(pinnedSpkiSha256,'hex')),
  'review key not independently pinned');
 const signature=Buffer.from(receipt.signature,'base64url');
 ok(signature.length===64&&verifyEd(null,canonical(p),createPublicKey(publicKeyPem),signature),
  'signature mismatch');
 const receiptSha256=createHash('sha256')
  .update(canonical(p)).update(signature).digest('hex');
 return Object.freeze({verified:true,receiptSha256,reviewKeyPinned:true,
  externalSignerHumanVerified:false,syntheticCi:true,
  productionAuthorized:false,externalDeploymentAllowed:false});
}
