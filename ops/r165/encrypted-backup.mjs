/**
 * R165: authenticated AES-256-GCM encryption of disposable PG17 custom backups.
 * Encrypts complete byte buffers for isolated DR rehearsal only.
 * Caller owns key bytes, must keep keys out of git/artifacts/logs.
 * Not a production KMS or offsite encrypted backup service.
 */
import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const MAGIC=Buffer.from('MARCOSA-R165-BACKUP-V1\n');
const HEADER_MAX=1024;
const DIGEST=/^[a-f0-9]{64}$/;
const SOURCE=/^[a-f0-9]{40}$/;
const fail=msg=>{throw Error('R165 encrypted archive: '+msg);};
const assert=(yes,msg)=>{if(!yes)fail(msg);};
function keyBytes(key){
 assert(Buffer.isBuffer(key)&&key.length===32,'external 32-byte key required');
 return key;
}
function context({commit,bundleSha256,sourceDb='postgres'}={}){
 assert(SOURCE.test(commit||'')&&DIGEST.test(bundleSha256||'')&&
  sourceDb==='postgres','only known synthetic PG17 source identity');
 return{schemaVersion:1,scope:'synthetic-ci-only',commit,bundleSha256,sourceDb,
  algorithm:'aes-256-gcm',productionAuthorized:false};
}
const sha=x=>createHash('sha256').update(x).digest('hex');
function meta(parsed){
 const allowed=['algorithm','bundleSha256','commit','createdAtMs','iv','plaintextSha256',
  'productionAuthorized','schemaVersion','scope','sourceDb'];
 assert(parsed&&Object.getPrototypeOf(parsed)===Object.prototype&&
  Object.keys(parsed).sort().join(',')===allowed.sort().join(','),
  'strict archive header contract');
 const standard=context(parsed);
 assert(parsed.schemaVersion===standard.schemaVersion&&parsed.scope===standard.scope&&
  parsed.algorithm===standard.algorithm&&parsed.productionAuthorized===false,
  'no production authority permitted');
 assert(typeof parsed.iv==='string'&&/^[a-f0-9]{24}$/.test(parsed.iv)&&
  DIGEST.test(parsed.plaintextSha256||'')&&
  Number.isSafeInteger(parsed.createdAtMs)&&parsed.createdAtMs>0,
  'valid IV, digest and creation time required');
}
export function sealR165Backup({plaintext,key,commit,bundleSha256,
 createdAtMs=Date.now(),iv=randomBytes(12)}={}){
 const secret=keyBytes(key);
 assert(Buffer.isBuffer(plaintext)&&plaintext.length>=512&&
  plaintext.length<=25*1024*1024,'bounded PostgreSQL custom backup required');
 assert(Buffer.isBuffer(iv)&&iv.length===12,'fresh 96-bit IV required');
 assert(Number.isSafeInteger(createdAtMs)&&createdAtMs>0,'valid creation clock');
 const a={...context({commit,bundleSha256}),createdAtMs,
  iv:iv.toString('hex'),plaintextSha256:sha(plaintext)};
 const header=Buffer.from(JSON.stringify(a),'utf8');
 assert(header.length<=HEADER_MAX,'archive metadata budget exceeded');
 const aad=Buffer.concat([MAGIC,Buffer.from(String(header.length).padStart(4,'0')),header]);
 const enc=createCipheriv('aes-256-gcm',secret,iv,{authTagLength:16});
 enc.setAAD(aad);
 const ciphertext=Buffer.concat([enc.update(plaintext),enc.final()]);
 const blob=Buffer.concat([aad,ciphertext,enc.getAuthTag()]);
 return Object.freeze({blob,encryptedSha256:sha(blob),plaintextSha256:a.plaintextSha256,
  size:blob.length,productionAuthorized:false,offsiteCopyVerified:false});
}
export function openR165Backup({blob,key,commit,bundleSha256,
 now=Date.now(),maxAgeMs=3600000}={}){
 const secret=keyBytes(key);
 assert(Buffer.isBuffer(blob)&&blob.length>=MAGIC.length+4+100+16+512&&
  blob.length<=25*1024*1024+HEADER_MAX+100,'bounded encrypted blob required');
 assert(blob.subarray(0,MAGIC.length).equals(MAGIC),'unrecognized archive envelope');
 const digits=blob.subarray(MAGIC.length,MAGIC.length+4).toString('utf8');
 assert(/^[0-9]{4}$/.test(digits),'invalid header length');
 const len=Number(digits),end=MAGIC.length+4+len;
 assert(len>=100&&len<=HEADER_MAX&&end+16+512<=blob.length,
  'truncated or oversized authenticated header');
 const aad=blob.subarray(0,end),headerText=blob.subarray(MAGIC.length+4,end).toString('utf8');
 let parsed;
 try{parsed=JSON.parse(headerText);}catch{fail('invalid header JSON');}
 meta(parsed);
 assert(parsed.commit===commit&&parsed.bundleSha256===bundleSha256,
  'encrypted archive source does not match pinned release');
 assert(Number.isSafeInteger(now)&&Number.isInteger(maxAgeMs)&&
  maxAgeMs>=1000&&maxAgeMs<=86400000&&
  parsed.createdAtMs<=now+10000&&now-parsed.createdAtMs<=maxAgeMs,
  'encrypted archive proof expired');
 const iv=Buffer.from(parsed.iv,'hex'),tag=blob.subarray(blob.length-16);
 const body=blob.subarray(end,blob.length-16);
 let plaintext;
 try{
  const dec=createDecipheriv('aes-256-gcm',secret,iv,{authTagLength:16});
  dec.setAAD(aad);dec.setAuthTag(tag);
  plaintext=Buffer.concat([dec.update(body),dec.final()]);
 }catch{fail('authentication failed, wrong key or tampered ciphertext');}
 assert(plaintext.length>=512&&plaintext.length<=25*1024*1024,
  'unexpected decrypted archive size');
 const actual=Buffer.from(sha(plaintext),'hex'),expected=Buffer.from(parsed.plaintextSha256,'hex');
 assert(timingSafeEqual(actual,expected),'plaintext backup digest mismatch');
 return Object.freeze({plaintext,archiveSha256:actual.toString('hex'),verified:true,
  createdAtMs:parsed.createdAtMs,productionAuthorized:false,
  realOffsiteRestoreVerified:false});
}
