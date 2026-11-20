/** R195 public-only Ed25519 packet. Binds full R194 source, historical claims,
 * actual offline R195 HTML, task manifests and per-role CSV/Markdown hashes.
 * Signer is disposable CI key: NO independent human authorization asserted.
 */
import {createHash,createPublicKey,sign,verify,timingSafeEqual} from 'node:crypto';
import {H40,H64,plain,requireTrue,verifyReceipt} from '../r190/common.mjs';
import {compareR194Evidence} from '../r194/evidence-delta.mjs';
import {compareR194Readiness} from '../r194/risk-trend.mjs';
import {verifyR194TaskLedger} from '../r194/task-ledger.mjs';
import {renderR195Dashboard} from './dashboard.mjs';
const domain=Buffer.from('MARCOSA/R195/OFFLINE-NO-GO/v1\n');
const sha=x=>createHash('sha256').update(x).digest('hex');
function trustKey(der,expected){
 requireTrue(Buffer.isBuffer(der)&&der.length===44&&H64.test(expected||'')&&
  timingSafeEqual(Buffer.from(sha(der),'hex'),Buffer.from(expected,'hex')),
  'independently supplied Ed25519 public key SHA pin required');
 let key;
 try{key=createPublicKey({key:der,type:'spki',format:'der'});}
 catch{throw Error('R195: invalid public key DER');}
 requireTrue(key.asymmetricKeyType==='ed25519'&&
  key.export({format:'der',type:'spki'}).equals(der),
  'noncanonical Ed25519 public key');
 return key;
}
function check({commit,bundleSha256,beforeIntake,afterIntake,
 beforeAssessment,afterAssessment,ledger,evidenceDelta,riskTrend,now}){
 for(const [p,kind] of [[beforeIntake,'R193_INTAKE'],
  [afterIntake,'R193_INTAKE'],[beforeAssessment,'R193_ASSESSMENT'],
  [afterAssessment,'R193_ASSESSMENT'],[ledger,'R194_TASK_LEDGER'],
  [evidenceDelta,'R194_EVIDENCE_DELTA'],[riskTrend,'R194_RISK_TREND']])
  verifyReceipt(p,kind,commit,bundleSha256);
 requireTrue(beforeAssessment.intakeEvidenceSha256===beforeIntake.evidenceSha256&&
  afterAssessment.intakeEvidenceSha256===afterIntake.evidenceSha256&&
  beforeAssessment.sourceCommit===afterAssessment.sourceCommit&&
  beforeAssessment.productionAuthorized===false&&
  afterAssessment.productionAuthorized===false,
  'R195 source history must bind exact intake and assessment hashes');
 const d=compareR194Evidence({commit,bundleSha256,
  before:beforeIntake,after:afterIntake,clock:()=>now});
 const t=compareR194Readiness({commit,bundleSha256,
  before:beforeAssessment,after:afterAssessment,clock:()=>now});
 requireTrue(JSON.stringify(d)===JSON.stringify(evidenceDelta)&&
  JSON.stringify(t)===JSON.stringify(riskTrend),
  'R195 evidence revision or risk report differs from source');
 verifyR194TaskLedger({ledger,assessment:afterAssessment,commit,bundleSha256});
 return renderR195Dashboard({commit,bundleSha256,
  assessment:afterAssessment,ledger,evidenceDelta,riskTrend});
}
export function createR195SignedPackage({
 commit,bundleSha256,beforeIntake,afterIntake,beforeAssessment,
 afterAssessment,ledger,evidenceDelta,riskTrend,
 privateKey,publicKeyDer,clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  privateKey&&typeof clock==='function',
  'exact git source, ephemeral signer and time required');
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&now>=afterAssessment.observedAtMs&&
  now<=afterAssessment.expiresAtMs,
  'signed package must be created during evidence validity');
 const rendered=check({commit,bundleSha256,beforeIntake,afterIntake,
  beforeAssessment,afterAssessment,ledger,evidenceDelta,riskTrend,now});
 const publicKeySha256=sha(publicKeyDer),key=trustKey(publicKeyDer,publicKeySha256);
 const packet={schemaVersion:1,kind:'R195_SOURCE_BOUND_PACKAGE',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:'CI_FIXTURE',createdAtMs:now,
  beforeIntake,afterIntake,beforeAssessment,afterAssessment,
  ledger,evidenceDelta,riskTrend,
  dashboardSha256:rendered.htmlSha256,
  markdownSha256:rendered.markdownSha256,
  scriptSha256:rendered.scriptSha256,
  handoffManifestSha256:rendered.handoffManifestSha256,
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  independentHumanIdentityEstablished:false,
  externallyVerifiedPermissions:false,
  productionAuthorized:false,realPilotAuthorized:false};
 requireTrue([beforeIntake,afterIntake].every(x=>x.sourceMode==='CI_FIXTURE'),
  'actual operator evidence must never be signed as disposable CI');
 const bytes=Buffer.from(JSON.stringify(packet)+'\n','utf8');
 requireTrue(bytes.length>=4500&&bytes.length<=200000,'bounded public evidence packet');
 const signature=sign(null,Buffer.concat([domain,bytes]),privateKey);
 requireTrue(signature.length===64&&
  verify(null,Buffer.concat([domain,bytes]),key,signature),
  'first runner source signature self-verification failed');
 return Object.freeze({bytes,signature,rendered,
  publicKeySha256,fileSha256:sha(bytes),
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  realPilotAuthorized:false,productionAuthorized:false});
}
export function verifyR195SignedPackage({
 bytes,signature,publicKeyDer,expectedPublicKeySha256,expectedFileSha256,
 expectedDashboardSha256,expectedMarkdownSha256,expectedHandoffSha256,
 commit,bundleSha256,clock=()=>Date.now(),allowHistoricalCi=false
}={}){
 requireTrue(Buffer.isBuffer(bytes)&&bytes.length>=4500&&bytes.length<=200000&&
  Buffer.isBuffer(signature)&&signature.length===64&&
  [expectedFileSha256,expectedDashboardSha256,expectedMarkdownSha256,
   expectedHandoffSha256].every(x=>H64.test(x||''))&&
  H40.test(commit||'')&&H64.test(bundleSha256||''),
  'complete externally pinned R195 public archive mandatory');
 const key=trustKey(publicKeyDer,expectedPublicKeySha256);
 requireTrue(timingSafeEqual(Buffer.from(sha(bytes),'hex'),
  Buffer.from(expectedFileSha256,'hex')),
  'source-bound R195 packet bytes changed between CI runners');
 requireTrue(verify(null,Buffer.concat([domain,bytes]),key,signature),
  'independent Ed25519 verification rejected signature');
 let p;
 try{p=JSON.parse(bytes.toString('utf8'));}
 catch{throw Error('R195: invalid JSON package');}
 requireTrue(plain(p)&&bytes.equals(Buffer.from(JSON.stringify(p)+'\n'))&&
  p.schemaVersion===1&&p.kind==='R195_SOURCE_BOUND_PACKAGE'&&
  p.sourceCommit===commit&&p.sourceBundleSha256===bundleSha256&&
  p.sourceMode==='CI_FIXTURE'&&
  p.decision==='NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED'&&
  p.independentHumanIdentityEstablished===false&&
  p.externallyVerifiedPermissions===false&&
  p.productionAuthorized===false&&p.realPilotAuthorized===false,
  'invalid source-bound package or fake human/production permission');
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&Number.isSafeInteger(p.createdAtMs)&&
  now>=p.createdAtMs&&now-p.createdAtMs<=3600000,
  'R195 package too old or from future');
 const at=allowHistoricalCi?p.createdAtMs:now;
 if(allowHistoricalCi)requireTrue(
  p.beforeIntake.sourceMode==='CI_FIXTURE'&&p.afterIntake.sourceMode==='CI_FIXTURE',
  'historical re-verification restricted to fixture-derived evidence');
 const rendered=check({commit,bundleSha256,
  beforeIntake:p.beforeIntake,afterIntake:p.afterIntake,
  beforeAssessment:p.beforeAssessment,afterAssessment:p.afterAssessment,
  ledger:p.ledger,evidenceDelta:p.evidenceDelta,riskTrend:p.riskTrend,now:at});
 requireTrue(rendered.htmlSha256===p.dashboardSha256&&
  rendered.markdownSha256===p.markdownSha256&&
  rendered.scriptSha256===p.scriptSha256&&
  rendered.handoffManifestSha256===p.handoffManifestSha256&&
  rendered.htmlSha256===expectedDashboardSha256&&
  rendered.markdownSha256===expectedMarkdownSha256&&
  rendered.handoffManifestSha256===expectedHandoffSha256,
  'independent deterministic offline HTML, handoffs or source verification failed');
 return Object.freeze({verified:true,sourceCommit:commit,
  handoffCount:rendered.handoffs.byOwner.length,
  decision:p.decision,productionAuthorized:false,realPilotAuthorized:false});
}
