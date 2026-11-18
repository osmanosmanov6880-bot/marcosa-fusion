/**
 * R164 two-key Ed25519 operator/reviewer authorization for a ONE-TIME
 * isolated staging DRILL. Both keys must be pinned out of band.
 * Cryptographic distinctness is NOT proof of different human operators.
 */
import {createPublicKey,createHash,verify as verifySignature,timingSafeEqual,
 randomBytes} from 'node:crypto';
const H64=/^[0-9a-f]{64}$/,H40=/^[0-9a-f]{40}$/;
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const roles=['operator','independent-reviewer'];
const fail=m=>{throw Error('R164 quorum: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const keys=x=>Object.keys(x).sort().join(',');
const packetKeys=['schemaVersion','repository','commit','targetDigest',
 'nonce','issuedAtMs','expiresAtMs','scope','synthetic'].sort().join(',');
const signatureKeys=['role','publicKeyPem','signature'].sort().join(',');
const pinKeys=['operator','independent-reviewer'].sort().join(',');
function keyFingerprint(pem){
 const key=createPublicKey(pem);
 ok(key.asymmetricKeyType==='ed25519','Ed25519 public key required');
 return createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
}
function canonical(p){
 return Buffer.from(JSON.stringify({schemaVersion:1,repository:REPO,
  commit:p.commit,targetDigest:p.targetDigest,nonce:p.nonce,
  issuedAtMs:p.issuedAtMs,expiresAtMs:p.expiresAtMs,
  scope:'staging-rehearsal-only',synthetic:p.synthetic}));
}
export function createR164DrillChallenge({
 commit,targetDigest,synthetic=true,clock=()=>Date.now(),
 nonce=randomBytes(16).toString('hex')
}={}){
 ok(typeof clock==='function','trusted clock required');
 const time=clock();
 const payload={schemaVersion:1,repository:REPO,commit,targetDigest,
  nonce,issuedAtMs:time,expiresAtMs:time+300000,
  scope:'staging-rehearsal-only',synthetic};
 validatePacket(payload,time);
 return Object.freeze(payload);
}
function validatePacket(p,now){
 ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
  keys(p)===packetKeys,'exact bounded challenge required');
 ok(p.schemaVersion===1&&p.repository===REPO&&
  H40.test(p.commit||'')&&H64.test(p.targetDigest||'')&&
  typeof p.nonce==='string'&&/^[a-f0-9]{32}$/.test(p.nonce)&&
  p.scope==='staging-rehearsal-only'&&typeof p.synthetic==='boolean',
  'unexpected identity/scope/nonce');
 ok(Number.isSafeInteger(now)&&
  Number.isSafeInteger(p.issuedAtMs)&&Number.isSafeInteger(p.expiresAtMs)&&
  p.issuedAtMs>=0&&p.issuedAtMs<=now+15000&&
  now<=p.expiresAtMs&&p.expiresAtMs>p.issuedAtMs&&
  p.expiresAtMs-p.issuedAtMs<=300000,
  'quorum challenge expired or excessively long');
}
export function verifyR164DualReview({
 packet,approvals,pinnedReviewerFingerprints,
 commit,targetDigest,clock=()=>Date.now()
}={}){
 ok(typeof clock==='function','bounded clock required');
 validatePacket(packet,clock());
 ok(packet.commit===commit&&packet.targetDigest===targetDigest,
  'signed change differs from exact stage source');
 ok(pinnedReviewerFingerprints&&Object.getPrototypeOf(pinnedReviewerFingerprints)===
  Object.prototype&&keys(pinnedReviewerFingerprints)===pinKeys,
  'two independently supplied public SPKI pins required');
 ok(H64.test(pinnedReviewerFingerprints.operator||'')&&
  H64.test(pinnedReviewerFingerprints['independent-reviewer']||'')&&
  pinnedReviewerFingerprints.operator!==pinnedReviewerFingerprints['independent-reviewer'],
  'operator/reviewer keys must differ');
 ok(Array.isArray(approvals)&&approvals.length===2,'exactly two signatures required');
 const seen=new Set();
 for(const entry of approvals){
  ok(entry&&Object.getPrototypeOf(entry)===Object.prototype&&
   keys(entry)===signatureKeys&&roles.includes(entry.role)&&!seen.has(entry.role),
   'one unique signature for each role required');
  seen.add(entry.role);
  ok(typeof entry.publicKeyPem==='string'&&entry.publicKeyPem.length<=2000,
   'bounded public key required');
  const fp=keyFingerprint(entry.publicKeyPem);
  const pin=pinnedReviewerFingerprints[entry.role];
  ok(timingSafeEqual(Buffer.from(fp,'hex'),Buffer.from(pin,'hex')),
   'reviewer public key not independently pinned');
  ok(typeof entry.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(entry.signature),
   'exact Ed25519 signature required');
  const sig=Buffer.from(entry.signature,'base64url');
  ok(sig.length===64&&verifySignature(null,canonical(packet),
   createPublicKey(entry.publicKeyPem),sig),'invalid signed rehearsal plan');
 }
 ok(seen.size===2,'missing operator or reviewer');
 return Object.freeze({commit,targetDigest,nonce:packet.nonce,
  expiry:packet.expiresAtMs,signatureCount:2,distinctPinnedKeys:true,
  synthetic:packet.synthetic,humanSeparationVerified:false,
  productionAuthorized:false,externalDeploymentAllowed:false});
}
export function createR164NonceFence({maxUses=128,clock=()=>Date.now()}={}){
 ok(Number.isInteger(maxUses)&&maxUses>=1&&maxUses<=2048&&
  typeof clock==='function','bounded nonce fence required');
 const seen=new Set();let closed=false;
 return Object.freeze({
  consume(proof){
   ok(!closed,'fence is closed');
   ok(proof&&proof.signatureCount===2&&proof.distinctPinnedKeys===true&&
    proof.productionAuthorized===false&&
    proof.synthetic===true&&typeof proof.nonce==='string'&&
    /^[a-f0-9]{32}$/.test(proof.nonce)&&
    proof.expiry>clock(),'only fresh synthetic CI rehearsal permitted');
   ok(!seen.has(proof.nonce)&&seen.size<maxUses,
    'reused nonce or exhausted fence');
   seen.add(proof.nonce);
   return Object.freeze({rehearsalPermitted:true,nonce:proof.nonce,
    productionAuthorized:false,externalDeploymentAllowed:false});
  },
  close(){closed=true;},
  status(){return Object.freeze({consumed:seen.size,closed,
   durableReplayProtection:false,productionAuthorized:false});}
 });
}
export const r164CanonicalChallengeBytes=canonical;
export const r164ReviewerFingerprint=keyFingerprint;
