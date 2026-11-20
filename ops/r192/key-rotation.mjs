/**
 * R192: appendable three-person Ed25519 trust-key rotation.
 * Replaces at most one key per event, all three prior keys must approve.
 * A trusted external old-registry file SHA is REQUIRED. New registry alone
 * cannot authorize an upgrade; no actual human identity is certified.
 */
import {createHash,createPublicKey,verify as verifyEd} from 'node:crypto';
import {H40,H64,plain,requireTrue,sealReceipt} from '../r190/common.mjs';
const SHA=x=>createHash('sha256').update(x).digest('hex');
const ROLES=['SECURITY','OPERATIONS','PRIVACY'];
const challengePrefix='MARCOSA/R192/TRUST-ROTATION-NO-GO/v1\n';
function decodeRegistry(bytes){
 requireTrue(Buffer.isBuffer(bytes)&&bytes.length>=400&&bytes.length<=8000,
  'bounded public reviewer registry required');
 let r;
 try{r=JSON.parse(bytes.toString('utf8'));}catch{throw Error('R192: registry JSON invalid');}
 requireTrue(plain(r)&&Object.keys(r).sort().join(',')==='generation,reviewers,schemaVersion,sourceCommit'&&
  r.schemaVersion===1&&Number.isSafeInteger(r.generation)&&
  r.generation>=1&&r.generation<=100000&&
  H40.test(r.sourceCommit||'')&&Array.isArray(r.reviewers)&&
  r.reviewers.length===3&&
  bytes.equals(Buffer.from(JSON.stringify(r)+'\n')),
  'noncanonical or malformed reviewer trust registry');
 const ids=new Set(),keys=new Set(),parsed=[];
 for(let i=0;i<3;i++){
  const x=r.reviewers[i];
  requireTrue(plain(x)&&Object.keys(x).sort().join(',')===
   'githubUserId,keyFingerprintSha256,publicKeySpkiBase64,role,signerId'&&
   x.role===ROLES[i]&&
   Number.isSafeInteger(x.githubUserId)&&x.githubUserId>0&&
   typeof x.signerId==='string'&&/^[a-z0-9_-]{4,64}$/.test(x.signerId)&&
   H64.test(x.keyFingerprintSha256||'')&&
   typeof x.publicKeySpkiBase64==='string'&&
   /^[A-Za-z0-9+/]+={0,2}$/.test(x.publicKeySpkiBase64),
   'reviewer key, role or GitHub identity malformed');
  const der=Buffer.from(x.publicKeySpkiBase64,'base64');
  requireTrue(der.length===44&&der.toString('base64')===x.publicKeySpkiBase64&&
   SHA(der)===x.keyFingerprintSha256&&
   !keys.has(x.keyFingerprintSha256)&&!ids.has(x.githubUserId),
   'reused key, identity or malformed Ed25519 DER');
  let key;
  try{key=createPublicKey({key:der,type:'spki',format:'der'});}
  catch{throw Error('R192: Ed25519 public key invalid');}
  requireTrue(key.asymmetricKeyType==='ed25519'&&
   key.export({type:'spki',format:'der'}).equals(der),
   'noncanonical Ed25519 trust anchor');
  ids.add(x.githubUserId);keys.add(x.keyFingerprintSha256);
  parsed.push({value:x,key});
 }
 return {record:r,parsed,sha:SHA(bytes)};
}
export function r192RotationMessage(packet){
 requireTrue(plain(packet)&&Object.keys(packet).sort().join(',')===
  'expiresAtMs,issuedAtMs,newRegistrySha256,nonce,oldRegistrySha256,sourceCommit'&&
  H40.test(packet.sourceCommit||'')&&
  [packet.oldRegistrySha256,packet.newRegistrySha256].every(x=>H64.test(x||''))&&
  /^[a-f0-9]{32}$/.test(packet.nonce||'')&&
  Number.isSafeInteger(packet.issuedAtMs)&&
  Number.isSafeInteger(packet.expiresAtMs)&&
  packet.expiresAtMs>packet.issuedAtMs&&
  packet.expiresAtMs-packet.issuedAtMs<=60000,
  'short-lived canonical rotation challenge required');
 return Buffer.from(challengePrefix+JSON.stringify(packet));
}
export function verifyR192KeyRotation({
 oldBytes,newBytes,expectedOldSha256,challenge,signatures,
 revokedFingerprintSha256=[],clock=()=>Date.now()
}={}){
 requireTrue(H64.test(expectedOldSha256||'')&&
  Array.isArray(revokedFingerprintSha256)&&
  revokedFingerprintSha256.every(x=>H64.test(x||''))&&
  typeof clock==='function','separate externally pinned old registry required');
 const old=decodeRegistry(oldBytes),next=decodeRegistry(newBytes);
 requireTrue(old.sha===expectedOldSha256&&
  next.record.sourceCommit===old.record.sourceCommit&&
  next.record.generation===old.record.generation+1,
  'external trust pin or monotonic registry generation failed');
 let changed=0;
 for(let i=0;i<3;i++){
  const a=old.parsed[i].value,b=next.parsed[i].value;
  requireTrue(a.role===b.role&&a.githubUserId===b.githubUserId&&
   a.signerId===b.signerId,
   'identity or role substitution must use external manual re-enrolment');
  if(a.keyFingerprintSha256!==b.keyFingerprintSha256)changed++;
  requireTrue(!revokedFingerprintSha256.includes(b.keyFingerprintSha256),
   'new registry cannot contain a revoked public key');
 }
 requireTrue(changed===1,'exactly one reviewer key may rotate per event');
 requireTrue(challenge?.sourceCommit===old.record.sourceCommit&&
  challenge.oldRegistrySha256===old.sha&&
  challenge.newRegistrySha256===next.sha,
  'rotation challenge hashes not bound to both registry versions');
 const msg=r192RotationMessage(challenge);
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&now>=challenge.issuedAtMs&&
  now<=challenge.expiresAtMs,'rotation challenge expired or future');
 requireTrue(Array.isArray(signatures)&&signatures.length===3,
  'all three old trust key signatures required for rotation');
 const seen=new Set();
 for(const row of signatures){
  requireTrue(plain(row)&&Object.keys(row).sort().join(',')===
   'role,signatureBase64url,signerId'&&ROLES.includes(row.role)&&
   !seen.has(row.role),'duplicate or unknown reviewer role');
  seen.add(row.role);
  const prior=old.parsed[ROLES.indexOf(row.role)];
  requireTrue(row.signerId===prior.value.signerId&&
   !revokedFingerprintSha256.includes(prior.value.keyFingerprintSha256)&&
   typeof row.signatureBase64url==='string'&&
   /^[A-Za-z0-9_-]{80,92}$/.test(row.signatureBase64url),
   'untrusted old signer or revoked key');
  const raw=Buffer.from(row.signatureBase64url,'base64url');
  requireTrue(raw.length===64&&raw.toString('base64url')===row.signatureBase64url&&
   verifyEd(null,msg,prior.key,raw),'Ed25519 key-rotation signature rejected');
 }
 return sealReceipt({schemaVersion:1,kind:'R192_ROTATION',
  sourceCommit:old.record.sourceCommit,
  sourceBundleSha256:challenge.newRegistrySha256,
  oldRegistrySha256:old.sha,newRegistrySha256:next.sha,
  priorGeneration:old.record.generation,newGeneration:next.record.generation,
  actualRotations:changed,verifiedOldSignerCount:3,observedAtMs:now,
  outsideHumanIdentityVerification:false,operatorQuorumIndependentlyVerified:false,
  decision:'NO_GO_ROTATION_REQUIRES_EXTERNAL_IDENTITY_SIGNOFF',
  realPilotAuthorized:false,productionAuthorized:false});
}
