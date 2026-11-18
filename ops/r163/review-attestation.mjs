/**
 * R163 offline Ed25519 evidence review challenge and signature verifier.
 * Caller MUST obtain expected reviewer SPKI pin through an independent,
 * out-of-band channel. CI-generated reviewer keys are test fixtures only.
 * A valid signature is evidence of a KEY, never permission to deploy.
 */
import {randomBytes,createPublicKey,createHash,verify as verifySig,
 timingSafeEqual} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const hex40=/^[0-9a-f]{40}$/,hex64=/^[0-9a-f]{64}$/;
const fail=m=>{throw Error('R163 attestation: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const equals=(a,b)=>Buffer.isBuffer(a)&&Buffer.isBuffer(b)&&
 a.length===b.length&&timingSafeEqual(a,b);
const keys=[
 'schemaVersion','repository','commit','bundleSha256','scope',
 'nonce','issuedAtMs','expiresAtMs','reviewResult'
].sort();
function canonical(o){return Buffer.from(JSON.stringify({
 schemaVersion:1,repository:REPO,commit:o.commit,
 bundleSha256:o.bundleSha256,scope:'isolated-staging-audit',
 nonce:o.nonce,issuedAtMs:o.issuedAtMs,expiresAtMs:o.expiresAtMs,
 reviewResult:'reviewed-for-staging-only'
}));}
function valid(o,now){
 ok(o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join(',')===keys.join(','),
  'exact review payload required');
 ok(o.schemaVersion===1&&o.repository===REPO&&hex40.test(o.commit)&&
  hex64.test(o.bundleSha256)&&o.scope==='isolated-staging-audit'&&
  o.reviewResult==='reviewed-for-staging-only'&&
  typeof o.nonce==='string'&&/^[a-f0-9]{32}$/.test(o.nonce),
  'unsupported scope, commit or replay nonce');
 ok(Number.isSafeInteger(o.issuedAtMs)&&Number.isSafeInteger(o.expiresAtMs)&&
  o.issuedAtMs>=0&&o.issuedAtMs<=now+30000&&
  o.expiresAtMs>o.issuedAtMs&&o.expiresAtMs-o.issuedAtMs<=900000&&
  now<=o.expiresAtMs,'expired, futuristic or unbounded review window');
}
export const reviewerKeyFingerprint=publicKey=>{
 const key=createPublicKey(publicKey);
 if(key.asymmetricKeyType!=='ed25519')fail('Ed25519 reviewer key required');
 return createHash('sha256').update(key.export({type:'spki',format:'der'}))
  .digest('hex');
};
export function createR163ReviewChallenge({
 commit,bundleSha256,clock=()=>Date.now(),nonce=randomBytes(16).toString('hex')
}={}){
 const now=clock();
 const o={schemaVersion:1,repository:REPO,commit,bundleSha256,
  scope:'isolated-staging-audit',nonce,issuedAtMs:now,expiresAtMs:now+600000,
  reviewResult:'reviewed-for-staging-only'};
 valid(o,now);return Object.freeze(o);
}
export function verifyR163ReviewAttestation({
 challenge,signature,reviewerPublicKey,reviewerPin,builderPin,
 commit,bundleSha256,clock=()=>Date.now()
}={}){
 const now=clock();
 valid(challenge,now);
 ok(challenge.commit===commit&&challenge.bundleSha256===bundleSha256,
  'review does not bind selected commit and exact bundle');
 ok(typeof reviewerPin==='string'&&hex64.test(reviewerPin)&&
  typeof builderPin==='string'&&hex64.test(builderPin)&&reviewerPin!==builderPin,
  'independent external reviewer key pin required');
 const calculated=reviewerKeyFingerprint(reviewerPublicKey);
 ok(equals(Buffer.from(calculated,'hex'),Buffer.from(reviewerPin,'hex')),
  'reviewer key not independently pinned');
 ok(typeof signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(signature),
  'canonical Ed25519 signature required');
 const sig=Buffer.from(signature,'base64url');
 ok(sig.length===64,'signature length invalid');
 let accepted=false;
 try{accepted=verifySig(null,canonical(challenge),
  createPublicKey(reviewerPublicKey),sig);}
 catch{accepted=false;}
 ok(accepted,'review evidence signature invalid');
 return Object.freeze({
  cryptographicSignatureVerified:true,
  reviewerKeyDistinctFromBuilder:true,
  humanIndependenceEstablished:false,
  stagingReviewArtifactVerified:true,
  validUntilMs:challenge.expiresAtMs,
  commit,bundleSha256,productionAuthorized:false,
  commercialPaymentsEnabled:false
 });
}
export const r163ReviewCanonicalBytes=canonical;
