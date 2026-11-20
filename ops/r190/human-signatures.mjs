/** Three pinned Ed25519 keys; verify source-bound human-review claims, never identities. */
import {createPublicKey,verify as verifyEd25519} from 'node:crypto';
import {H32,H40,H64,plain,keys,sha256,requireTrue,sealReceipt} from './common.mjs';
const ROLES=['SECURITY','OPERATIONS','PRIVACY'];
const domain='MARCOSA/R190/OFFLINE-REVIEW-NO-GO/v1\n';
function pub(b64){
 requireTrue(typeof b64==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(b64)&&
  b64.length<=128,'noncanonical base64 public key');
 const raw=Buffer.from(b64,'base64');
 requireTrue(raw.length===44&&raw.toString('base64')===b64,'noncanonical SPKI DER');
 const key=createPublicKey({key:raw,format:'der',type:'spki'});
 requireTrue(key.asymmetricKeyType==='ed25519'&&
  key.export({type:'spki',format:'der'}).equals(raw),'not Ed25519 SPKI');
 return{key,fingerprint:sha256(raw)};
}
export function r190ReviewMessage(packet){
 requireTrue(plain(packet)&&keys(packet)==='bundleSha256,expiresAtMs,githubEvidenceSha256,issuedAtMs,nonce,sourceCommit,tlsEvidenceSha256'&&
  packet.sourceCommit&&H40.test(packet.sourceCommit)&&
  [packet.bundleSha256,packet.githubEvidenceSha256,packet.tlsEvidenceSha256]
   .every(x=>H64.test(x||''))&&H32.test(packet.nonce||'')&&
  Number.isSafeInteger(packet.issuedAtMs)&&packet.issuedAtMs>0&&
  Number.isSafeInteger(packet.expiresAtMs)&&
  packet.expiresAtMs>packet.issuedAtMs&&
  packet.expiresAtMs-packet.issuedAtMs<=300000,
  'source-bound short-lived reviewer packet invalid');
 return Buffer.from(domain+JSON.stringify(packet));
}
export function verifyR190ReviewSignatures({packet,signatures,registry,
 revokedFingerprints=[],clock=()=>Date.now()}={}){
 const message=r190ReviewMessage(packet);
 const at=clock();
 requireTrue(Number.isSafeInteger(at)&&at>=packet.issuedAtMs&&
  at<=packet.expiresAtMs,'expired or future reviewer packet');
 requireTrue(plain(registry)&&keys(registry)==='OPERATIONS,PRIVACY,SECURITY'&&
  Array.isArray(signatures)&&signatures.length===3&&
  Array.isArray(revokedFingerprints)&&revokedFingerprints.every(x=>H64.test(x)),
  'exact pinned three-role trust registry required');
 const seen=new Set(),identities=new Set(),fingerprints=new Set();
 const verified=[];
 for(const role of ROLES){
  const r=registry[role];
  requireTrue(plain(r)&&keys(r)==='keyFingerprintSha256,publicKeySpkiBase64,signerId'&&
   typeof r.signerId==='string'&&/^[a-z0-9_-]{4,64}$/.test(r.signerId)&&
   H64.test(r.keyFingerprintSha256||'')&&
   !identities.has(r.signerId),'pinned external identity registry invalid');
  identities.add(r.signerId);
  const trust=pub(r.publicKeySpkiBase64);
  requireTrue(trust.fingerprint===r.keyFingerprintSha256&&
   !fingerprints.has(trust.fingerprint)&&
   !revokedFingerprints.includes(trust.fingerprint),
   'reviewer key changed, reused or revoked');
  fingerprints.add(trust.fingerprint);
  const row=signatures.find(s=>s?.role===role);
  requireTrue(plain(row)&&keys(row)==='role,signatureBase64url,signerId'&&
   row.signerId===r.signerId&&!seen.has(row.role)&&
   typeof row.signatureBase64url==='string'&&
   /^[A-Za-z0-9_-]+$/.test(row.signatureBase64url),
   'reviewer signature identity/role mismatch');
  seen.add(role);
  const sig=Buffer.from(row.signatureBase64url,'base64url');
  requireTrue(sig.length===64&&sig.toString('base64url')===row.signatureBase64url&&
   verifyEd25519(null,message,trust.key,sig),
   'Ed25519 reviewer signature verification failed');
  verified.push({role,signerId:r.signerId,publicKeyFingerprintSha256:trust.fingerprint});
 }
 requireTrue(new Set(signatures.map(s=>s.role)).size===3,
  'unrecognized or duplicate signatures rejected');
 return sealReceipt({schemaVersion:1,kind:'R190_SIGNERS',
  sourceCommit:packet.sourceCommit,sourceBundleSha256:packet.bundleSha256,
  packetSha256:sha256(message),nonce:packet.nonce,
  githubEvidenceSha256:packet.githubEvidenceSha256,
  tlsEvidenceSha256:packet.tlsEvidenceSha256,
  cryptographicSignaturesVerified:3,verifiedSigners:verified,
  externallyVerifiedHumanIdentities:false,
  independentRegistryAuthorityVerified:false,
  observedAtMs:at,decision:'NO_GO_REAL_REVIEWER_IDENTITY_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
