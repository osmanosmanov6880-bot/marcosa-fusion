/**
 * Offline R194 package: actual Ed25519 signature, SHA pins and deterministic
 * report re-render from verified source-bound R193 receipts and task history.
 * CI keys are ephemeral and cannot establish real-world operator identity.
 */
import {createHash,createPublicKey,sign,verify,timingSafeEqual} from 'node:crypto';
import {H40,H64,plain,requireTrue,verifyReceipt} from '../r190/common.mjs';
import {compareR194Evidence} from './evidence-delta.mjs';
import {compareR194Readiness} from './risk-trend.mjs';
import {verifyR194TaskLedger} from './task-ledger.mjs';
import {renderR194Interactive} from './interactive-dashboard.mjs';
const domain=Buffer.from('MARCOSA/R194/OFFLINE-NO-GO/v1\n');
const sha=x=>createHash('sha256').update(x).digest('hex');
function pinnedKey(der,expected){
 requireTrue(Buffer.isBuffer(der)&&der.length===44&&H64.test(expected||'')&&
  timingSafeEqual(Buffer.from(sha(der),'hex'),Buffer.from(expected,'hex')),
  'independently supplied public Ed25519 key pin required');
 let key;
 try{key=createPublicKey({key:der,format:'der',type:'spki'});}
 catch{throw Error('R194: invalid key DER');}
 requireTrue(key.asymmetricKeyType==='ed25519'&&
  key.export({format:'der',type:'spki'}).equals(der),
  'noncanonical Ed25519 public key');
 return key;
}
export function createR194Package({
 commit,bundleSha256,beforeIntake,afterIntake,
 beforeAssessment,afterAssessment,ledger,evidenceDelta,riskTrend,
 privateKey,publicKeyDer,clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  privateKey&&typeof clock==='function','source, signer and clock mandatory');
 const now=clock();
 const results=verifyComponents({commit,bundleSha256,beforeIntake,afterIntake,
  beforeAssessment,afterAssessment,ledger,evidenceDelta,riskTrend,now});
 const keySha256=sha(publicKeyDer),publicKey=pinnedKey(publicKeyDer,keySha256);
 const packet={schemaVersion:1,kind:'R194_PORTABLE_NO_GO',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:'CI_FIXTURE',createdAtMs:now,
  beforeIntake,afterIntake,beforeAssessment,afterAssessment,
  ledger,evidenceDelta,riskTrend,
  htmlSha256:results.rendered.htmlSha256,
  markdownSha256:results.rendered.markdownSha256,
  clientScriptSha256:results.rendered.clientScriptSha256,
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  independentHumanVerification:false,
  realPilotAuthorized:false,productionAuthorized:false};
 const bytes=Buffer.from(JSON.stringify(packet)+'\n','utf8');
 requireTrue(bytes.length>=3500&&bytes.length<=200000,
  'bounded canonical no-GO artifact required');
 const signature=sign(null,Buffer.concat([domain,bytes]),privateKey);
 requireTrue(signature.length===64&&
  verify(null,Buffer.concat([domain,bytes]),publicKey,signature),
  'ephemeral CI signature self-check failed');
 return Object.freeze({bytes,signature,keySha256,
  fileSha256:sha(bytes),rendered:results.rendered,
  productionAuthorized:false});
}
function verifyComponents({
 commit,bundleSha256,beforeIntake,afterIntake,
 beforeAssessment,afterAssessment,ledger,evidenceDelta,riskTrend,now
}){
 for(const [item,kind] of [
  [beforeIntake,'R193_INTAKE'],[afterIntake,'R193_INTAKE'],
  [beforeAssessment,'R193_ASSESSMENT'],[afterAssessment,'R193_ASSESSMENT'],
  [ledger,'R194_TASK_LEDGER'],
  [evidenceDelta,'R194_EVIDENCE_DELTA'],
  [riskTrend,'R194_RISK_TREND']
 ])verifyReceipt(item,kind,commit,bundleSha256);
 requireTrue(beforeAssessment.intakeEvidenceSha256===beforeIntake.evidenceSha256&&
  afterAssessment.intakeEvidenceSha256===afterIntake.evidenceSha256&&
  beforeAssessment.sourceCommit===afterAssessment.sourceCommit,
  'risk snapshots must bind the exact intake evidence');
 const ed=compareR194Evidence({commit,bundleSha256,
  before:beforeIntake,after:afterIntake,clock:()=>now});
 const rt=compareR194Readiness({commit,bundleSha256,
  before:beforeAssessment,after:afterAssessment,clock:()=>now});
 requireTrue(JSON.stringify(ed)===JSON.stringify(evidenceDelta)&&
  JSON.stringify(rt)===JSON.stringify(riskTrend),
  'independently recomputed evidence history or risk delta differs');
 verifyR194TaskLedger({ledger,assessment:afterAssessment,commit,bundleSha256});
 const rendered=renderR194Interactive({commit,bundleSha256,
  assessment:afterAssessment,ledger,evidenceDelta,riskTrend});
 return {rendered};
}
export function verifyR194Package({
 bytes,signature,publicKeyDer,expectedPublicKeySha256,
 expectedFileSha256,expectedHtmlSha256,expectedMarkdownSha256,
 commit,bundleSha256,clock=()=>Date.now(),allowHistoricalCi=false
}={}){
 requireTrue(Buffer.isBuffer(bytes)&&bytes.length>=3500&&bytes.length<=200000&&
  Buffer.isBuffer(signature)&&signature.length===64&&
  [expectedFileSha256,expectedHtmlSha256,expectedMarkdownSha256]
    .every(x=>H64.test(x||''))&&
  H40.test(commit||'')&&H64.test(bundleSha256||''),
  'complete source-pinned public package and SHA pins required');
 const key=pinnedKey(publicKeyDer,expectedPublicKeySha256);
 requireTrue(timingSafeEqual(Buffer.from(sha(bytes),'hex'),
  Buffer.from(expectedFileSha256,'hex')),
  'source packet changed between runs');
 requireTrue(verify(null,Buffer.concat([domain,bytes]),key,signature),
  'independent Ed25519 signature rejected');
 let p;
 try{p=JSON.parse(bytes.toString('utf8'));}
 catch{throw Error('R194: invalid canonical package JSON');}
 requireTrue(plain(p)&&bytes.equals(Buffer.from(JSON.stringify(p)+'\n'))&&
  p.kind==='R194_PORTABLE_NO_GO'&&p.schemaVersion===1&&
  p.sourceMode==='CI_FIXTURE'&&p.sourceCommit===commit&&
  p.sourceBundleSha256===bundleSha256&&
  p.decision==='NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED'&&
  p.realPilotAuthorized===false&&p.productionAuthorized===false&&
  p.independentHumanVerification===false,
  'invalid source-bound CI NO-GO packet');
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&Number.isSafeInteger(p.createdAtMs)&&
  now>=p.createdAtMs&&now-p.createdAtMs<=3600000,
  'stale or future R194 artifact');
 const at=allowHistoricalCi?p.createdAtMs:now;
 if(allowHistoricalCi)requireTrue(
  p.beforeIntake.sourceMode==='CI_FIXTURE'&&
  p.afterIntake.sourceMode==='CI_FIXTURE',
  'historical verification is for synthetic CI only');
 const result=verifyComponents({commit,bundleSha256,
  beforeIntake:p.beforeIntake,afterIntake:p.afterIntake,
  beforeAssessment:p.beforeAssessment,afterAssessment:p.afterAssessment,
  ledger:p.ledger,evidenceDelta:p.evidenceDelta,
  riskTrend:p.riskTrend,now:at});
 requireTrue(result.rendered.htmlSha256===p.htmlSha256&&
  result.rendered.markdownSha256===p.markdownSha256&&
  result.rendered.clientScriptSha256===p.clientScriptSha256&&
  result.rendered.htmlSha256===expectedHtmlSha256&&
  result.rendered.markdownSha256===expectedMarkdownSha256,
  'independent re-rendered mobile workspace changed');
 return Object.freeze({verified:true,
  sourceCommit:commit,reportSha256:result.rendered.htmlSha256,
  decision:p.decision,
  realPilotAuthorized:false,productionAuthorized:false});
}
