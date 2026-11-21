/**
 * R180 two distinct Ed25519 signer KEYS on an explicit NO-GO packet.
 * CI uses ephemeral keys. Two signatures NEVER prove two natural persons,
 * verified GitHub reviewers, external AWS or production authorization.
 */
import {createHash,createPublicKey,createPrivateKey,
 sign as edSign,verify as edVerify,timingSafeEqual} from 'node:crypto';
import {verifyR180Classification} from './evidence-classifier.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/,BASE64=/^[A-Za-z0-9+/]+={0,2}$/;
const fail=m=>{throw Error('R180 quorum: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const keys=x=>Object.keys(x||{}).sort().join(',');
const packed={
 schemaVersion:0,sourceCommit:'',sourceBundleSha256:'',
 reviewEvidenceSha256:'',classificationSha256:'',runId:0,sequence:0,
 nonce:'',scope:'',decision:'',issuedAtMs:0,expiresAtMs:0,
 realHumanApprovalsVerified:false,productionAuthorized:false
};
const packetKeys=keys(packed);
const signerKeys='role,signatureBase64,spkiDerBase64,spkiSha256';
function privateKey(x){
 try{return x?.type==='private'?x:createPrivateKey(x);}
 catch{fail('Ed25519 private signing key unavailable');}
}
function publicKey(x){
 try{return createPublicKey({key:Buffer.from(x,'base64'),
  type:'spki',format:'der'});}
 catch{fail('invalid pinned Ed25519 public key SPKI');}
}
function fingerprint(key){
 const p=createPublicKey(privateKey(key));
 ok(p.asymmetricKeyType==='ed25519','only Ed25519 signer allowed');
 return Object.freeze({publicKey:p,
  spkiDerBase64:p.export({type:'spki',format:'der'}).toString('base64'),
  spkiSha256:sha(p.export({type:'spki',format:'der'}))});
}
export function r180SignerPin(privateSigningKey){
 return fingerprint(privateSigningKey).spkiSha256;
}
function validatePacket(p,{commit,bundleSha256,classificationSha256,
 clock=()=>Date.now(),historicalRead=false}={}){
 const now=clock();
 ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
  keys(p)===packetKeys&&
  p.schemaVersion===1&&
  H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  H64.test(classificationSha256||'')&&
  p.sourceCommit===commit&&p.sourceBundleSha256===bundleSha256&&
  p.classificationSha256===classificationSha256&&
  H64.test(p.reviewEvidenceSha256||'')&&
  Number.isSafeInteger(p.runId)&&p.runId>=10000&&
  Number.isSafeInteger(p.sequence)&&p.sequence>=2&&p.sequence<=32&&
  H32.test(p.nonce||'')&&
  p.scope==='isolated-native-pg17-no-go-quorum'&&
  p.decision==='NO_GO_EXTERNAL_EVIDENCE_PENDING'&&
  p.realHumanApprovalsVerified===false&&
  p.productionAuthorized===false&&
  Number.isSafeInteger(p.issuedAtMs)&&p.issuedAtMs>0&&
  Number.isSafeInteger(p.expiresAtMs)&&
  p.expiresAtMs-p.issuedAtMs===600000&&
  Number.isSafeInteger(now)&&now>=p.issuedAtMs&&
  (historicalRead===true||now<=p.expiresAtMs),
  'quorum packet mutated, expired, not source-pinned or falsely elevated');
}
export function issueR180Quorum({classification,operatorPrivateKey,
 auditorPrivateKey,expectedOperatorPin,expectedAuditorPin,
 clock=()=>Date.now()}={}){
 ok(classification&&
  H64.test(expectedOperatorPin||'')&&H64.test(expectedAuditorPin||'')&&
  expectedOperatorPin!==expectedAuditorPin,
  'externally pinned distinct Ed25519 signers required');
 verifyR180Classification(classification,{commit:classification.sourceCommit,
  bundleSha256:classification.sourceBundleSha256,clock});
 const a=fingerprint(operatorPrivateKey),b=fingerprint(auditorPrivateKey);
 ok(equal(a.spkiSha256,expectedOperatorPin)&&
  equal(b.spkiSha256,expectedAuditorPin)&&
  a.spkiSha256!==b.spkiSha256,
  'operator and auditor signing keys must match two different pins');
 const issuedAtMs=clock();
 ok(Number.isSafeInteger(issuedAtMs)&&issuedAtMs>0,
  'bounded signature issued timestamp required');
 const packet={
  schemaVersion:1,sourceCommit:classification.sourceCommit,
  sourceBundleSha256:classification.sourceBundleSha256,
  reviewEvidenceSha256:classification.reviewEvidenceSha256,
  classificationSha256:classification.evidenceSha256,
  runId:classification.runId,sequence:classification.sequence,
  nonce:classification.nonce,scope:'isolated-native-pg17-no-go-quorum',
  decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING',
  issuedAtMs,expiresAtMs:issuedAtMs+600000,
  realHumanApprovalsVerified:false,productionAuthorized:false
 };
 const bytes=Buffer.from(JSON.stringify(packet));
 const approvals=Object.freeze([
  {role:'operator',spkiSha256:a.spkiSha256,
   spkiDerBase64:a.spkiDerBase64,
   signatureBase64:edSign(null,bytes,privateKey(operatorPrivateKey)).toString('base64')},
  {role:'auditor',spkiSha256:b.spkiSha256,
   spkiDerBase64:b.spkiDerBase64,
   signatureBase64:edSign(null,bytes,privateKey(auditorPrivateKey)).toString('base64')}
 ]);
 const receipt={
  schemaVersion:1,packet,
  approvals:approvals.map(x=>Object.freeze(x)),
  actualHumanApprovalsVerified:false,productionAuthorized:false
 };
 const out=Object.freeze({...receipt,approvals,
  receiptSha256:sha(Buffer.from(JSON.stringify(receipt)))});
 verifyR180Quorum(out,{commit:classification.sourceCommit,
  bundleSha256:classification.sourceBundleSha256,
  classificationSha256:classification.evidenceSha256,
  expectedOperatorPin,expectedAuditorPin,clock});
 return out;
}
export function verifyR180Quorum(receipt,{commit,bundleSha256,
 classificationSha256,expectedOperatorPin,expectedAuditorPin,
 clock=()=>Date.now(),historicalRead=false}={}){
 ok(receipt&&Object.getPrototypeOf(receipt)===Object.prototype&&
  keys(receipt)==='actualHumanApprovalsVerified,approvals,packet,productionAuthorized,receiptSha256,schemaVersion'&&
  receipt.schemaVersion===1&&
  receipt.actualHumanApprovalsVerified===false&&
  receipt.productionAuthorized===false&&
  H64.test(receipt.receiptSha256||'')&&
  H64.test(expectedOperatorPin||'')&&
  H64.test(expectedAuditorPin||'')&&
  expectedOperatorPin!==expectedAuditorPin&&
  Array.isArray(receipt.approvals)&&receipt.approvals.length===2,
  'exact dual-signature NO-GO receipt contract required');
 validatePacket(receipt.packet,{commit,bundleSha256,
  classificationSha256,clock,historicalRead});
 const payload=Buffer.from(JSON.stringify(receipt.packet));
 const seen=new Set();
 for(let i=0;i<2;i++){
  const a=receipt.approvals[i];
  ok(a&&Object.getPrototypeOf(a)===Object.prototype&&
   keys(a)===signerKeys&&
   a.role===(i===0?'operator':'auditor')&&
   H64.test(a.spkiSha256||'')&&
   a.spkiSha256===(i===0?expectedOperatorPin:expectedAuditorPin)&&
   !seen.has(a.spkiSha256)&&
   typeof a.spkiDerBase64==='string'&&BASE64.test(a.spkiDerBase64)&&
   a.spkiDerBase64.length<=256&&
   typeof a.signatureBase64==='string'&&
   BASE64.test(a.signatureBase64)&&a.signatureBase64.length<=128,
   'duplicate, unpinned or malformed signer evidence');
  seen.add(a.spkiSha256);
  const pub=publicKey(a.spkiDerBase64);
  ok(pub.asymmetricKeyType==='ed25519'&&
   equal(sha(pub.export({type:'spki',format:'der'})),a.spkiSha256),
   'public key does not match pinned Ed25519 identity');
  const sig=Buffer.from(a.signatureBase64,'base64');
  ok(sig.length===64&&edVerify(null,payload,pub,sig),
   'Ed25519 approval does not cover exact NO-GO packet bytes');
 }
 const {receiptSha256,...base}=receipt;
 ok(equal(receiptSha256,sha(Buffer.from(JSON.stringify(base)))),
  'immutable full quorum receipt digest mismatch');
 return Object.freeze({verified:true,twoDistinctKeys:true,
  fresh:historicalRead!==true,actualHumanApprovalsVerified:false,
  productionAuthorized:false,receiptSha256});
}
