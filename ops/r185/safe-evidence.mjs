/**
 * R185 public-safe evidence export, canonical JSON, deterministic SHA256,
 * exact allowlist and no secret-bearing provider payloads.
 *
 * SHA256 proves byte integrity, not human/provider identity or approvals.
 * Do not include raw AWS, GH, HTTP, user, customer or database records.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const fail=m=>{throw Error('R185 safe evidence: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(x).digest('hex');
const BLOCKERS=['INDEPENDENT_GITHUB_APPROVALS',
 'AWS_EFFECTIVE_PERMISSIONS','REAL_STAGING_BOUNDARY',
 'PRIVATE_DATA_REVIEW','REAL_RECOVERY_OBJECTIVES'];
const publicFields=['schemaVersion','scope','sourceCommit',
 'sourceBundleSha256','runId','r184EvidenceSha256',
 'intakeEvidenceSha256','rehearsalEvidenceSha256',
 'requiredBlockingChecks','simulatedWindowCount',
 'rehearsalFailed','hypotheticalRollbackPassed',
 'realProviderIndependentlyAttested','realHumanIdentityVerified',
 'realProductionRpoRtoVerified','realPilotAuthorized',
 'productionAuthorized','decision','observedAtMs',
 'evidenceSha256'];
const topKeys=x=>Object.keys(x||{}).sort().join(',');
const full=x=>H64.test(x||'');
const noSecrets=v=>{
 const raw=JSON.stringify(v);
 ok(typeof raw==='string'&&raw.length<=40000&&
  !/(?:password|secret|api[_-]?key|private[_-]?key|authorization|bearer\s+|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,})/i.test(raw),
  'secret-bearing provider payloads or passwords forbidden');
};
function verifyProof(p,kind){
 ok(p&&Object.getPrototypeOf(p)===Object.prototype,
  kind+' proof must be an exact JSON object');
 noSecrets(p);
 const {evidenceSha256,...raw}=p;
 ok(full(evidenceSha256)&&
  timingSafeEqual(Buffer.from(evidenceSha256,'hex'),
   Buffer.from(sha(JSON.stringify(raw)),'hex')),
  kind+' SHA256 must verify source bytes');
}
function validate(o,expectedCommit,expectedBundle){
 ok(o&&Object.getPrototypeOf(o)===Object.prototype&&
  topKeys(o)===publicFields.slice().sort().join(',')&&
  o.schemaVersion===1&&
  o.scope==='nonsecret-ci-synthetic-staging-readiness'&&
  H40.test(o.sourceCommit||'')&&full(o.sourceBundleSha256)&&
  (expectedCommit===undefined||o.sourceCommit===expectedCommit)&&
  (expectedBundle===undefined||o.sourceBundleSha256===expectedBundle)&&
  Number.isSafeInteger(o.runId)&&o.runId>=10000&&
  full(o.r184EvidenceSha256)&&full(o.intakeEvidenceSha256)&&
  full(o.rehearsalEvidenceSha256)&&
  Array.isArray(o.requiredBlockingChecks)&&
  o.requiredBlockingChecks.length===BLOCKERS.length&&
  o.requiredBlockingChecks.every((x,i)=>x===BLOCKERS[i])&&
  Number.isSafeInteger(o.simulatedWindowCount)&&
  o.simulatedWindowCount>=1&&o.simulatedWindowCount<=4&&
  typeof o.rehearsalFailed==='boolean'&&
  o.hypotheticalRollbackPassed===true&&
  o.realProviderIndependentlyAttested===false&&
  o.realHumanIdentityVerified===false&&
  o.realProductionRpoRtoVerified===false&&
  o.realPilotAuthorized===false&&
  o.productionAuthorized===false&&
  o.decision==='NO_GO_ACTIONABLE_STAGING_REQUIREMENTS'&&
  Number.isSafeInteger(o.observedAtMs)&&o.observedAtMs>0&&
  full(o.evidenceSha256),
  'canonical safe evidence schema, source pins or NO-GO invariant changed');
 const {evidenceSha256,...body}=o;
 ok(timingSafeEqual(Buffer.from(sha(JSON.stringify(body)),'hex'),
  Buffer.from(evidenceSha256,'hex')),
  'safe evidence SHA256 digest mismatch');
 noSecrets(o);
}
export function buildR185SafeEvidence({intake,rehearsal}={}){
 verifyProof(intake,'intake');verifyProof(rehearsal,'rehearsal');
 ok(intake?.decision==='NO_GO_ACTIONABLE_STAGING_REQUIREMENTS'&&
  intake.blockedCount===5&&
  intake.blockers?.length===5&&
  intake.blockers.every((b,i)=>b.code===BLOCKERS[i])&&
  intake.realProviderIndependentlyAttested===false&&
  intake.realHumansIndependentlyVerified===false&&
  intake.realPilotAuthorized===false&&
  intake.productionAuthorized===false&&
  rehearsal.sourceCommit===intake.sourceCommit&&
  rehearsal.sourceBundleSha256===intake.sourceBundleSha256&&
  rehearsal.runId===intake.runId&&
  rehearsal.intakeEvidenceSha256===intake.evidenceSha256&&
  rehearsal.scope==='synthetic-staging-canary-rehearsal-only'&&
  rehearsal.actualTrafficRouted===false&&
  rehearsal.actualDeploymentAttempted===false&&
  rehearsal.stopped===true&&
  rehearsal.simulatedRollbackVerified===true&&
  rehearsal.realPilotAuthorized===false&&
  rehearsal.productionAuthorized===false&&
  ['NO_GO_REHEARSAL_COMPLETED','NO_GO_REHEARSAL_ABORTED'].includes(
   rehearsal.decision),
  'intake and synthetic rehearsal cannot be promoted or cross-source mixed');
 const o={
  schemaVersion:1,scope:'nonsecret-ci-synthetic-staging-readiness',
  sourceCommit:intake.sourceCommit,
  sourceBundleSha256:intake.sourceBundleSha256,
  runId:intake.runId,r184EvidenceSha256:intake.r184EvidenceSha256,
  intakeEvidenceSha256:intake.evidenceSha256,
  rehearsalEvidenceSha256:rehearsal.evidenceSha256,
  requiredBlockingChecks:BLOCKERS.slice(),
  simulatedWindowCount:rehearsal.windowsAnalyzed,
  rehearsalFailed:rehearsal.failureReason!=='NONE',
  hypotheticalRollbackPassed:true,
  realProviderIndependentlyAttested:false,
  realHumanIdentityVerified:false,
  realProductionRpoRtoVerified:false,
  realPilotAuthorized:false,productionAuthorized:false,
  decision:'NO_GO_ACTIONABLE_STAGING_REQUIREMENTS',
  observedAtMs:Math.max(intake.observedAtMs,rehearsal.observedAtMs)
 };
 const packet={...o,evidenceSha256:sha(JSON.stringify(o))};
 validate(packet,intake.sourceCommit,intake.sourceBundleSha256);
 const bytes=Buffer.from(JSON.stringify(packet)+'\n','utf8');
 ok(bytes.length>=300&&bytes.length<=4096,'bounded safe evidence export');
 return Object.freeze({bytes,sha256:sha(bytes),packet,
  productionAuthorized:false});
}
export function verifyR185SafeEvidence({bytes,commit,bundleSha256,
 expectedFileSha256}={}){
 ok(Buffer.isBuffer(bytes)&&bytes.length>=300&&bytes.length<=4096&&
  H40.test(commit||'')&&full(bundleSha256)&&full(expectedFileSha256),
  'exact source SHA and independently supplied file hash required');
 const actual=sha(bytes);
 ok(timingSafeEqual(Buffer.from(actual,'hex'),
  Buffer.from(expectedFileSha256,'hex')),
  'independent file checksum mismatched');
 let parsed;
 try{parsed=JSON.parse(bytes.toString('utf8'));}
 catch{fail('safe evidence JSON corrupted');}
 validate(parsed,commit,bundleSha256);
 ok(bytes.equals(Buffer.from(JSON.stringify(parsed)+'\n')),
  'noncanonical whitespace, duplicate keys or extra payload forbidden');
 return Object.freeze({verified:true,sha256:actual,
  sourceCommit:commit,runId:parsed.runId,
  blockingChecks:parsed.requiredBlockingChecks.slice(),
  realPilotAuthorized:false,productionAuthorized:false});
}
