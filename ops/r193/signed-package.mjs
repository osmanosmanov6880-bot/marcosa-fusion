/**
 * R193 portable source-bound offline artifact: SHA-256 manifest and genuine
 * Ed25519 signature from explicit ephemeral CI key. Sender cannot self-
 * certify a human identity; second runner pins public SPKI DER separately.
 */
import {createHash,createPublicKey,sign as signEd25519,verify as verifyEd25519,
 timingSafeEqual} from 'node:crypto';
import {H40,H64,plain,requireTrue,verifyReceipt} from '../r190/common.mjs';
import {assessR193Readiness} from './assessment.mjs';
import {renderR193Dashboard} from './dashboard.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const domain=Buffer.from('MARCOSA/R193/CI-SYNTHETIC-NO-GO/v1\n');
function testSafeKey(publicKeyDer,expectedPublicKeySha256){
 requireTrue(Buffer.isBuffer(publicKeyDer)&&publicKeyDer.length===44&&
  H64.test(expectedPublicKeySha256||'')&&
  sha(publicKeyDer)===expectedPublicKeySha256,
  'independent external Ed25519 key pin required');
 let key;
 try{key=createPublicKey({key:publicKeyDer,format:'der',type:'spki'});}
 catch{throw Error('R193: invalid public signing key');}
 requireTrue(key.asymmetricKeyType==='ed25519'&&
  key.export({type:'spki',format:'der'}).equals(publicKeyDer),
  'noncanonical Ed25519 SPKI');
 return key;
}
function packetRaw({commit,bundleSha256,github,intake,assessment,rendered,at}){
 return {
  schemaVersion:1,kind:'R193_OFFLINE_PACKET',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:'CI_FIXTURE',createdAtMs:at,
  github,intake,assessment,
  htmlSha256:rendered.htmlSha256,
  markdownSha256:rendered.markdownSha256,
  evidenceOrder:['R193_GITHUB','R193_INTAKE','R193_ASSESSMENT'],
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  independentExternalHumanIdentitiesVerified:false,
  actualProductionInfrastructureAttested:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
}
export function createR193SignedPackage({
 commit,bundleSha256,github,intake,assessment,
 privateKey,publicKeyDer,clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  privateKey&&typeof clock==='function',
  'CI ephemeral private key and source bundle required');
 const publicKeySha256=sha(publicKeyDer);
 const key=testSafeKey(publicKeyDer,publicKeySha256);
 const now=clock();
 for(const [proof,kind] of [[github,'R193_GITHUB'],[intake,'R193_INTAKE'],
  [assessment,'R193_ASSESSMENT']]){
  const r=verifyReceipt(proof,kind,commit,bundleSha256);
  requireTrue(r.sourceMode==='CI_FIXTURE'||kind==='R193_ASSESSMENT',
   'real operator evidence cannot be signed as synthetic CI');
 }
 const rebuilt=assessR193Readiness({commit,bundleSha256,github,intake,
  clock:()=>assessment.observedAtMs});
 requireTrue(JSON.stringify(rebuilt)===JSON.stringify(assessment),
  'independent readiness assessment mismatch');
 const rendered=renderR193Dashboard({commit,bundleSha256,assessment});
 const packet=packetRaw({commit,bundleSha256,github,intake,assessment,
  rendered,at:now});
 const bytes=Buffer.from(JSON.stringify(packet)+'\n','utf8');
 requireTrue(bytes.length>=1800&&bytes.length<=130000,
  'bounded canonical public CI packet required');
 const signature=signEd25519(null,Buffer.concat([domain,bytes]),privateKey);
 requireTrue(signature.length===64&&verifyEd25519(null,
  Buffer.concat([domain,bytes]),key,signature),
  'locally signed CI manifest failed verification');
 return Object.freeze({bytes,signature,publicKeySha256,
  bundleFileSha256:sha(bytes),rendered,
  decision:packet.decision,productionAuthorized:false});
}
export function verifyR193SignedPackage({
 bytes,signature,publicKeyDer,expectedPublicKeySha256,
 expectedBundleFileSha256,expectedHtmlSha256,
 expectedMarkdownSha256,commit,bundleSha256,
 clock=()=>Date.now(),allowHistoricalCi=false
}={}){
 requireTrue(Buffer.isBuffer(bytes)&&bytes.length>=1800&&
  bytes.length<=130000&&Buffer.isBuffer(signature)&&signature.length===64&&
  H64.test(expectedBundleFileSha256||'')&&
  H64.test(expectedHtmlSha256||'')&&
  H64.test(expectedMarkdownSha256||'')&&
  H40.test(commit||'')&&H64.test(bundleSha256||''),
  'complete pinned public artifact required');
 const key=testSafeKey(publicKeyDer,expectedPublicKeySha256);
 requireTrue(timingSafeEqual(Buffer.from(sha(bytes),'hex'),
  Buffer.from(expectedBundleFileSha256,'hex')),
  'public packet bytes changed between runners');
 requireTrue(verifyEd25519(null,Buffer.concat([domain,bytes]),key,signature),
  'independent Ed25519 packet signature rejected');
 let obj;
 try{obj=JSON.parse(bytes.toString('utf8'));}
 catch{throw Error('R193: packet JSON malformed');}
 requireTrue(plain(obj)&&bytes.equals(Buffer.from(JSON.stringify(obj)+'\n'))&&
  obj.schemaVersion===1&&obj.kind==='R193_OFFLINE_PACKET'&&
  obj.sourceCommit===commit&&obj.sourceBundleSha256===bundleSha256&&
  obj.sourceMode==='CI_FIXTURE'&&obj.decision==='NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED'&&
  obj.productionAuthorized===false&&obj.realPilotAuthorized===false&&
  obj.independentExternalHumanIdentitiesVerified===false&&
  obj.actualProductionInfrastructureAttested===false,
  'source-bound immutable NO-GO packet invalid');
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&Number.isSafeInteger(obj.createdAtMs)&&
  now>=obj.createdAtMs&&now-obj.createdAtMs<=3600000,
  'expired or future portable packet');
 const observedAt=allowHistoricalCi?obj.assessment?.observedAtMs:now;
 const rebuilt=assessR193Readiness({commit,bundleSha256,
  github:obj.github,intake:obj.intake,clock:()=>observedAt});
 requireTrue(JSON.stringify(rebuilt)===JSON.stringify(obj.assessment),
  'source claims or readiness assessment altered');
 const rendered=renderR193Dashboard({commit,bundleSha256,assessment:rebuilt});
 requireTrue(rendered.htmlSha256===obj.htmlSha256&&
  rendered.markdownSha256===obj.markdownSha256&&
  rendered.htmlSha256===expectedHtmlSha256&&
  rendered.markdownSha256===expectedMarkdownSha256,
  'reports differ from independently recomputed source evidence');
 return Object.freeze({verified:true,sourceCommit:commit,
  reportSha256:rebuilt.evidenceSha256,
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  realPilotAuthorized:false,productionAuthorized:false});
}
