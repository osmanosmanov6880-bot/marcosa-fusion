/**
 * R167 source-bound X25519 -> HKDF-SHA256 -> AES-256-GCM data key envelope.
 * This module never creates a production key or contacts a KMS. Its caller
 * supplies an independently pinned recipient key; private key stays at target.
 */
import {createHash,createPublicKey,createPrivateKey,generateKeyPairSync,
 diffieHellman,hkdfSync,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
const H40=/^[0-9a-f]{40}$/,H64=/^[0-9a-f]{64}$/;
const MAGIC='marcosa-r167-synthetic-ci-v1',MAXAGE=3600000;
const invalid=m=>{throw Error('R167 envelope: '+m);};
const requireTrue=(v,m)=>{if(!v)invalid(m);};
const digest=x=>createHash('sha256').update(x).digest('hex');
export function r167RecipientFingerprint(publicKey){
 const key=publicKey?.type==='public'?publicKey:createPublicKey(publicKey);
 requireTrue(key.asymmetricKeyType==='x25519','recipient must be X25519');
 return digest(key.export({format:'der',type:'spki'}));
}
function sharedContext(x){
 return {version:1,scope:MAGIC,sourceCommit:x.sourceCommit,
  bundleSha256:x.bundleSha256,ciphertextSha256:x.ciphertextSha256,
  recipientSpkiSha256:x.recipientSpkiSha256,keyEpoch:x.keyEpoch,
  ephemeralSpkiDer:x.ephemeralSpkiDer,iv:x.iv,
  issuedAtMs:x.issuedAtMs,expiresAtMs:x.expiresAtMs,
  productionAuthorized:false};
}
function checkContext(x,{now,minimumKeyEpoch=1}={}){
 requireTrue(x&&typeof x==='object'&&!Array.isArray(x)&&
  x.version===1&&x.scope===MAGIC&&x.productionAuthorized===false&&
  H40.test(x.sourceCommit||'')&&H64.test(x.bundleSha256||'')&&
  H64.test(x.ciphertextSha256||'')&&H64.test(x.recipientSpkiSha256||'')&&
  Number.isSafeInteger(x.keyEpoch)&&x.keyEpoch>=minimumKeyEpoch&&x.keyEpoch<=9999,
  'source-bound exact key version required');
 requireTrue(typeof x.ephemeralSpkiDer==='string'&&x.ephemeralSpkiDer.length<200&&
  /^[A-Za-z0-9_-]+$/.test(x.ephemeralSpkiDer)&&
  typeof x.iv==='string'&&/^[0-9a-f]{24}$/.test(x.iv)&&
  Number.isSafeInteger(x.issuedAtMs)&&x.issuedAtMs>0&&
  Number.isSafeInteger(x.expiresAtMs)&&x.expiresAtMs>x.issuedAtMs&&
  x.expiresAtMs-x.issuedAtMs<=MAXAGE,
  'bounded key envelope required');
 if(now!==undefined)requireTrue(Number.isSafeInteger(now)&&
  x.issuedAtMs<=now+15000&&now<=x.expiresAtMs,'key envelope expired');
}
function wrappingKey({localPrivate,remotePublic,context}){
 const shared=diffieHellman({privateKey:localPrivate,publicKey:remotePublic});
 try{
  return Buffer.from(hkdfSync('sha256',shared,
   Buffer.from(context.ciphertextSha256,'hex'),
   Buffer.from('MARCOSA R167 wrapped data key | '+JSON.stringify(context),'utf8'),32));
 }finally{shared.fill(0);}
}
export function wrapR167DataKey({dataKey,recipientPublicKey,
 pinnedRecipientSpkiSha256,sourceCommit,bundleSha256,ciphertextSha256,
 keyEpoch=1,clock=()=>Date.now(),ttlMs=MAXAGE}={}){
 requireTrue(Buffer.isBuffer(dataKey)&&dataKey.length===32,'32-byte AES data key required');
 requireTrue(typeof clock==='function'&&Number.isInteger(ttlMs)&&
  ttlMs>=60000&&ttlMs<=MAXAGE,'bounded TTL required');
 const recipient=recipientPublicKey?.type==='public'?
  recipientPublicKey:createPublicKey(recipientPublicKey);
 const actualPin=r167RecipientFingerprint(recipient);
 requireTrue(H64.test(pinnedRecipientSpkiSha256||'')&&
  timingSafeEqual(Buffer.from(actualPin,'hex'),Buffer.from(pinnedRecipientSpkiSha256,'hex')),
  'independently pinned recipient SPKI required');
 const ephemeral=generateKeyPairSync('x25519'),now=clock(),iv=randomBytes(12);
 const context=sharedContext({sourceCommit,bundleSha256,ciphertextSha256,
  recipientSpkiSha256:actualPin,keyEpoch,
  ephemeralSpkiDer:ephemeral.publicKey.export({format:'der',type:'spki'}).toString('base64url'),
  iv:iv.toString('hex'),issuedAtMs:now,expiresAtMs:now+ttlMs});
 checkContext(context,{now});
 const kek=wrappingKey({localPrivate:ephemeral.privateKey,
  remotePublic:recipient,context});
 let encrypted,tag;
 try{
  const cipher=createCipheriv('aes-256-gcm',kek,iv,{authTagLength:16});
  cipher.setAAD(Buffer.from(JSON.stringify(context)));
  encrypted=Buffer.concat([cipher.update(dataKey),cipher.final()]);
  tag=cipher.getAuthTag();
 }finally{kek.fill(0);}
 return Object.freeze({...context,wrappedKey:encrypted.toString('base64url'),
  authTag:tag.toString('hex')});
}
export function unwrapR167DataKey({envelope,recipientPrivateKey,
 pinnedRecipientSpkiSha256,sourceCommit,bundleSha256,ciphertextSha256,
 minimumKeyEpoch=1,clock=()=>Date.now()}={}){
 requireTrue(typeof clock==='function'&&Number.isSafeInteger(minimumKeyEpoch)&&
  minimumKeyEpoch>=1,'trusted epoch clock required');
 requireTrue(envelope&&Object.getPrototypeOf(envelope)===Object.prototype,
  'strict key envelope required');
 const header=sharedContext(envelope);
 const allowed=Object.keys({...header,wrappedKey:'',authTag:''}).sort().join(',');
 requireTrue(Object.keys(envelope).sort().join(',')===allowed&&
  envelope.version===1&&envelope.scope===MAGIC&&
  envelope.productionAuthorized===false&&
  JSON.stringify(header)===JSON.stringify(sharedContext(header)),
  'unknown field or elevated key envelope scope');
 checkContext(header,{now:clock(),minimumKeyEpoch});
 requireTrue(header.sourceCommit===sourceCommit&&header.bundleSha256===bundleSha256&&
  header.ciphertextSha256===ciphertextSha256&&
  header.recipientSpkiSha256===pinnedRecipientSpkiSha256,
  'source, ciphertext or recipient identity changed');
 const receiver=recipientPrivateKey?.type==='private'?
  recipientPrivateKey:createPrivateKey(recipientPrivateKey);
 requireTrue(receiver.asymmetricKeyType==='x25519'&&
  r167RecipientFingerprint(createPublicKey(receiver))===pinnedRecipientSpkiSha256,
  'private key not owned by independently pinned recipient');
 requireTrue(typeof envelope.wrappedKey==='string'&&
  /^[A-Za-z0-9_-]{43}$/.test(envelope.wrappedKey)&&
  typeof envelope.authTag==='string'&&/^[0-9a-f]{32}$/.test(envelope.authTag),
  'bounded AEAD data key encoding');
 let sender;
 try{sender=createPublicKey({key:Buffer.from(header.ephemeralSpkiDer,'base64url'),
  format:'der',type:'spki'});}catch{invalid('invalid sender ephemeral X25519 key');}
 requireTrue(sender.asymmetricKeyType==='x25519','sender must be X25519');
 const kek=wrappingKey({localPrivate:receiver,remotePublic:sender,context:header});
 try{
  const dec=createDecipheriv('aes-256-gcm',kek,Buffer.from(header.iv,'hex'),{authTagLength:16});
  dec.setAAD(Buffer.from(JSON.stringify(header)));
  dec.setAuthTag(Buffer.from(envelope.authTag,'hex'));
  const key=Buffer.concat([dec.update(Buffer.from(envelope.wrappedKey,'base64url')),dec.final()]);
  requireTrue(key.length===32,'recovered AES key length invalid');
  return key;
 }catch{invalid('authenticated key unwrap refused');}
 finally{kek.fill(0);}
}
/**
 * ONLY for disposable GitHub CI. Deterministic, PUBLICLY DERIVABLE private
 * key allows cross-runner functional testing; it provides ZERO secrecy.
 */
export function r167SyntheticCiRecipient({sourceCommit,epoch=1}={}){
 requireTrue(H40.test(sourceCommit||'')&&Number.isSafeInteger(epoch)&&
  epoch>=1&&epoch<=100,'synthetic fixture source required');
 const seed=createHash('sha256').update(
  'MARCOSA R167 PUBLIC DETERMINISTIC INSECURE TEST KEY '+sourceCommit+' '+epoch).digest();
 const der=Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),seed]);
 const privateKey=createPrivateKey({key:der,format:'der',type:'pkcs8'});
 seed.fill(0);der.fill(0);
 const publicKey=createPublicKey(privateKey);
 return Object.freeze({privateKey,publicKey,
  publicKeyPem:publicKey.export({format:'pem',type:'spki'}),
  pinnedSpkiSha256:r167RecipientFingerprint(publicKey),keyEpoch:epoch,
  publiclyDerivableTestKey:true,externalKmsVerified:false,productionAuthorized:false});
}
