/**
 * R175: two-key Ed25519 anchor for the monotonic R174 archive checkpoint.
 * Key separation is cryptographic only. Actual human identity is NOT proven.
 * All signed source values are explicit; no "latest" or implicit AWS lookup.
 */
import {createHash,createPublicKey,createPrivateKey,sign,verify,timingSafeEqual}
 from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const roles=['operator','independent-reviewer'];
const fail=m=>{throw Error('R175 dual anchor: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const keys=x=>Object.keys(x).sort().join(',');
const manifestKeys=['schemaVersion','repository','scope','sequence','commit',
 'bundleSha256','archiveSha256','escrowSha256','checkpointSha256',
 'priorAnchorSha256','issuedAtMs','expiresAtMs','productionAuthorized']
 .sort().join(',');
const approvalKeys='publicKeyPem,role,signature,signerSpkiSha256';
function publicInfo(key){
 const pub=createPublicKey(key);
 ok(pub.asymmetricKeyType==='ed25519','only Ed25519 SPKI signer accepted');
 const pem=pub.export({format:'pem',type:'spki'});
 return{publicKeyPem:pem,signerSpkiSha256:sha(
  pub.export({format:'der',type:'spki'}))};
}
function validate(m,clock){
 const now=clock();
 ok(m&&Object.getPrototypeOf(m)===Object.prototype&&
  keys(m)===manifestKeys&&m.schemaVersion===1&&
  m.repository===REPO&&m.scope==='isolated-offsite-monotonic-checkpoint'&&
  m.productionAuthorized===false&&
  Number.isSafeInteger(m.sequence)&&m.sequence>0&&
  H40.test(m.commit||'')&&
  [m.bundleSha256,m.archiveSha256,m.escrowSha256,
   m.checkpointSha256,m.priorAnchorSha256].every(x=>H64.test(x||''))&&
  (m.sequence!==1||m.priorAnchorSha256==='0'.repeat(64))&&
  (m.sequence===1||m.priorAnchorSha256!=='0'.repeat(64))&&
  Number.isSafeInteger(now)&&now>0&&
  Number.isSafeInteger(m.issuedAtMs)&&Number.isSafeInteger(m.expiresAtMs)&&
  m.issuedAtMs<=now+30000&&m.expiresAtMs>=now&&
  m.expiresAtMs-m.issuedAtMs>=3600000&&
  m.expiresAtMs-m.issuedAtMs<=30*86400000,
  'exact checkpoint, bounded expiry and chained parent required');
 return m;
}
export function issueR175DualAnchor({data,operatorKey,reviewerKey,
 clock=()=>Date.now(),ttlDays=7}={}){
 ok(Number.isSafeInteger(ttlDays)&&ttlDays>=1&&ttlDays<=30,
  'anchor TTL from 1 to 30 days only');
 const issuedAtMs=clock();
 const manifest=validate({
  schemaVersion:1,repository:REPO,
  scope:'isolated-offsite-monotonic-checkpoint',
  sequence:data?.sequence,commit:data?.commit,
  bundleSha256:data?.bundleSha256,archiveSha256:data?.archiveSha256,
  escrowSha256:data?.escrowSha256,checkpointSha256:data?.checkpointSha256,
  priorAnchorSha256:data?.priorAnchorSha256,
  issuedAtMs,expiresAtMs:issuedAtMs+ttlDays*86400000,
  productionAuthorized:false
 },clock);
 const payload=Buffer.from(JSON.stringify(manifest));
 const approvals=[operatorKey,reviewerKey].map((key,i)=>{
  const priv=key?.type==='private'?key:createPrivateKey(key);
  ok(priv.asymmetricKeyType==='ed25519','two Ed25519 private keys required');
  const pub=publicInfo(priv);
  return Object.freeze({role:roles[i],...pub,
   signature:sign(null,payload,priv).toString('base64url')});
 });
 ok(approvals[0].signerSpkiSha256!==approvals[1].signerSpkiSha256,
  'independent signer keys required');
 return Object.freeze({manifest:Object.freeze(manifest),
  approvals:Object.freeze(approvals),anchorSha256:sha(payload),
  realHumanApprovalVerified:false,productionAuthorized:false});
}
export function verifyR175DualAnchor({receipt,pinnedOperatorSpkiSha256,
 pinnedReviewerSpkiSha256,commit,bundleSha256,archiveSha256,
 escrowSha256,checkpointSha256,sequence,priorAnchorSha256,
 clock=()=>Date.now()}={}){
 ok(receipt&&Object.getPrototypeOf(receipt)===Object.prototype&&
  keys(receipt)==='anchorSha256,approvals,manifest,productionAuthorized,realHumanApprovalVerified'&&
  receipt.productionAuthorized===false&&
  receipt.realHumanApprovalVerified===false&&
  Array.isArray(receipt.approvals)&&receipt.approvals.length===2&&
  receipt.approvals.every((x,i)=>x&&Object.getPrototypeOf(x)===Object.prototype&&
   keys(x)===approvalKeys&&x.role===roles[i])&&
  H64.test(pinnedOperatorSpkiSha256||'')&&
  H64.test(pinnedReviewerSpkiSha256||'')&&
  pinnedOperatorSpkiSha256!==pinnedReviewerSpkiSha256,
  'exact two approved Ed25519 signer pins required');
 const m=validate(receipt.manifest,clock);
 ok(m.commit===commit&&m.bundleSha256===bundleSha256&&
  m.archiveSha256===archiveSha256&&m.escrowSha256===escrowSha256&&
  m.checkpointSha256===checkpointSha256&&
  m.sequence===sequence&&m.priorAnchorSha256===priorAnchorSha256,
  'latest checkpoint content or parent differs');
 const payload=Buffer.from(JSON.stringify(m));
 ok(same(receipt.anchorSha256,sha(payload)),'anchor digest changed');
 for(let i=0;i<2;i++){
  const a=receipt.approvals[i],pub=publicInfo(a.publicKeyPem);
  const pinned=i===0?pinnedOperatorSpkiSha256:pinnedReviewerSpkiSha256;
  ok(same(a.signerSpkiSha256,pinned)&&
   same(a.signerSpkiSha256,pub.signerSpkiSha256)&&
   typeof a.signature==='string'&&
   /^[A-Za-z0-9_-]{86}$/.test(a.signature)&&
   verify(null,payload,createPublicKey(a.publicKeyPem),
    Buffer.from(a.signature,'base64url')),
   'signer fingerprint/signature untrusted');
 }
 return Object.freeze({verified:true,anchorSha256:receipt.anchorSha256,
  sequence,manifest:m,signerKeysDistinct:true,
  realHumanApprovalVerified:false,productionAuthorized:false});
}
