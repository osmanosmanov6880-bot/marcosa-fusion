/**
 * R167 signed synthetic migration manifest / independent target inventory.
 * Source signature verifies integrity, not independent human authorization.
 */
import {createHash,createPublicKey,createPrivateKey,sign,verify,timingSafeEqual} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R167 transfer manifest: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const invFields=['auditHead','auditRows','quarantineClosed','quarantineGeneration',
 'publicRows','privateRows','activeSessions','revokedSessions',
 'privateRls','publicRls','browserCanReadPrivate','readerCanReadPrivate',
 'writerCanDeleteAudit','rowsDigest'].sort().join(',');
const manifestFields=['schemaVersion','scope','sourceCommit','bundleSha256',
 'ciphertextSha256','ciphertextBytes','envelopeSha256','recipientSpkiSha256',
 'sourceInventory','issuedAtMs','expiresAtMs','productionAuthorized','externalKmsVerified']
 .sort().join(',');
function checkInventory(inv){
 ok(inv&&Object.getPrototypeOf(inv)===Object.prototype&&
  Object.keys(inv).sort().join(',')===invFields,'exact non-PII inventory required');
 for(const name of ['auditRows','quarantineGeneration','publicRows','privateRows',
  'activeSessions','revokedSessions'])
  ok(Number.isSafeInteger(inv[name])&&inv[name]>=0&&inv[name]<=100000,
   'bounded inventory counts required');
 for(const name of ['quarantineClosed','privateRls','publicRls',
  'browserCanReadPrivate','readerCanReadPrivate','writerCanDeleteAudit'])
  ok(typeof inv[name]==='boolean','boolean permission proof required');
 ok(inv.publicRows===3&&inv.privateRows===2&&inv.auditRows===3&&
  inv.activeSessions===1&&inv.revokedSessions===1&&
  inv.quarantineClosed===true&&inv.quarantineGeneration===5&&
  inv.privateRls===true&&inv.publicRls===true&&
  inv.browserCanReadPrivate===false&&inv.readerCanReadPrivate===true&&
  inv.writerCanDeleteAudit===false&&H64.test(inv.auditHead||'')&&
  H64.test(inv.rowsDigest||''),'synthetic PG17 security invariants missing');
}
const meta=x=>({
 schemaVersion:1,scope:'isolated-cross-runner-ci',
 sourceCommit:x.sourceCommit,bundleSha256:x.bundleSha256,
 ciphertextSha256:x.ciphertextSha256,ciphertextBytes:x.ciphertextBytes,
 envelopeSha256:x.envelopeSha256,recipientSpkiSha256:x.recipientSpkiSha256,
 sourceInventory:x.sourceInventory,issuedAtMs:x.issuedAtMs,
 expiresAtMs:x.expiresAtMs,productionAuthorized:false,
 externalKmsVerified:false
});
const canonical=x=>Buffer.from(JSON.stringify(meta(x)));
function checkManifest(m,now){
 ok(m&&Object.getPrototypeOf(m)===Object.prototype&&
  Object.keys(m).sort().join(',')===manifestFields&&m.schemaVersion===1&&
  m.scope==='isolated-cross-runner-ci'&&m.productionAuthorized===false&&
  m.externalKmsVerified===false&&H40.test(m.sourceCommit||'')&&
  [m.bundleSha256,m.ciphertextSha256,m.envelopeSha256,m.recipientSpkiSha256].every(
   x=>H64.test(x||''))&&Number.isSafeInteger(m.ciphertextBytes)&&
  m.ciphertextBytes>700&&m.ciphertextBytes<=25*1024*1024+2048,
  'exact source-bound synthetic transfer manifest required');
 checkInventory(m.sourceInventory);
 ok(Number.isSafeInteger(now)&&Number.isSafeInteger(m.issuedAtMs)&&
  Number.isSafeInteger(m.expiresAtMs)&&m.issuedAtMs>0&&
  m.issuedAtMs<=now+15000&&now<=m.expiresAtMs&&
  m.expiresAtMs>m.issuedAtMs&&m.expiresAtMs-m.issuedAtMs<=3600000,
  'stale or unbounded signed manifest');
}
export function r167SignedManifestFingerprint(publicKeyPem){
 const pub=publicKeyPem?.type==='public'?publicKeyPem:createPublicKey(publicKeyPem);
 ok(pub.asymmetricKeyType==='ed25519','Ed25519 signer key required');
 return sha(pub.export({format:'der',type:'spki'}));
}
export function createR167TransferManifest({
 sourceCommit,bundleSha256,ciphertextSha256,ciphertextBytes,
 envelope,recipientSpkiSha256,sourceInventory,
 privateKey,clock=()=>Date.now(),ttlMs=3600000
}={}){
 ok(typeof clock==='function'&&Number.isInteger(ttlMs)&&
  ttlMs>=60000&&ttlMs<=3600000,'bounded signing lifetime');
 const envelopeSha256=sha(Buffer.from(JSON.stringify(envelope)));
 const now=clock();
 const manifest=meta({sourceCommit,bundleSha256,ciphertextSha256,
  ciphertextBytes,envelopeSha256,recipientSpkiSha256,sourceInventory,
  issuedAtMs:now,expiresAtMs:now+ttlMs});
 checkManifest(manifest,now);
 const key=privateKey?.type==='private'?privateKey:createPrivateKey(privateKey);
 ok(key.asymmetricKeyType==='ed25519','Ed25519 signer required');
 const publicKeyPem=createPublicKey(key).export({format:'pem',type:'spki'});
 return Object.freeze({manifest:Object.freeze(manifest),publicKeyPem,
  signerSpkiSha256:r167SignedManifestFingerprint(publicKeyPem),
  signature:sign(null,canonical(manifest),key).toString('base64url'),
  independentHumanApproved:false,productionAuthorized:false});
}
export function verifyR167TransferManifest({
 receipt,envelope,expectedCommit,expectedBundleSha256,
 expectedCiphertextSha256,expectedSignerSpkiSha256,
 expectedRecipientSpkiSha256,clock=()=>Date.now()
}={}){
 ok(receipt&&Object.getPrototypeOf(receipt)===Object.prototype&&
  Object.keys(receipt).sort().join(',')===
  'independentHumanApproved,manifest,productionAuthorized,publicKeyPem,signature,signerSpkiSha256'&&
  receipt.productionAuthorized===false&&receipt.independentHumanApproved===false,
  'exact offline receipt shape required');
 checkManifest(receipt.manifest,clock());
 const m=receipt.manifest;
 ok(m.sourceCommit===expectedCommit&&m.bundleSha256===expectedBundleSha256&&
  m.ciphertextSha256===expectedCiphertextSha256&&
  m.recipientSpkiSha256===expectedRecipientSpkiSha256&&
  m.envelopeSha256===sha(Buffer.from(JSON.stringify(envelope))),
  'manifest source, wrapped key or archive identity changed');
 const pin=r167SignedManifestFingerprint(receipt.publicKeyPem);
 ok(H64.test(receipt.signerSpkiSha256||'')&&
  H64.test(expectedSignerSpkiSha256||'')&&
  timingSafeEqual(Buffer.from(pin,'hex'),Buffer.from(receipt.signerSpkiSha256,'hex'))&&
  timingSafeEqual(Buffer.from(pin,'hex'),Buffer.from(expectedSignerSpkiSha256,'hex')),
  'source Ed25519 signer not independently pinned');
 ok(typeof receipt.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)&&
  verify(null,canonical(m),createPublicKey(receipt.publicKeyPem),
   Buffer.from(receipt.signature,'base64url')),
  'signature does not verify');
 return Object.freeze({verified:true,manifest:m,signerPinned:true,
  receiptSha256:sha(Buffer.from(JSON.stringify(receipt))),
  independentHumanApproved:false,productionAuthorized:false});
}
export function verifyR167RestoredInventory({source,restored}={}){
 checkInventory(source);checkInventory(restored);
 const expected=Buffer.from(JSON.stringify(source)),actual=Buffer.from(JSON.stringify(restored));
 ok(expected.length===actual.length&&timingSafeEqual(expected,actual),
  'independent PG17 restored permissions or rows differ');
 return Object.freeze({verified:true,rlsPreserved:true,quarantineClosed:true,
  sessionRevocationPreserved:true,archiveFromSeparateRunner:true,
  realSupabaseVerified:false,productionAuthorized:false});
}
