/**
 * MARCOSA R185: typed staging evidence intake with actionable blockers.
 * This is a DIAGNOSTIC and produces no authorization, release token,
 * credential or external write. CI synthetic and manual read-only claims
 * can NEVER be promoted to independent provider/human attestation.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R185 intake: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const kinds=Object.freeze(['AWS_IDENTITY_AND_S3',
 'IAM_BOUNDARY_AND_DENY','GITHUB_ENVIRONMENT','GITHUB_PR_REVIEW']);
const modes=new Set(['CI_SYNTHETIC','OPERATOR_READONLY_UNATTESTED']);
export const R185_REQUIRED_EVIDENCE_KINDS=kinds;
const tasks=Object.freeze([
 {code:'INDEPENDENT_GITHUB_APPROVALS',
  next:'Obtain two real independent PR and deployment approvals on exact HEAD; independently verify identities'},
 {code:'AWS_EFFECTIVE_PERMISSIONS',
  next:'Verify live AWS STS principals, organization SCPs, boundary, resource and KMS policies in both accounts'},
 {code:'REAL_STAGING_BOUNDARY',
  next:'Audit actual staging ingress, isolation, secrets, rollback and stop controls without customer traffic'},
 {code:'PRIVATE_DATA_REVIEW',
  next:'Complete privacy, retention and redaction assessment on a permitted staging data set'},
 {code:'REAL_RECOVERY_OBJECTIVES',
  next:'Measure authorized staging RPO/RTO from a controlled fault drill with verified restore'}
]);
const keys=o=>Object.keys(o||{}).sort().join(',');
export function createR185StagingIntake({clock=()=>Date.now(),
 allowInspect=false}={}){
 ok(typeof clock==='function','clock required');
 function inspect({commit,bundleSha256,runId,r184EvidenceSha256,
  providerEvidence,quarantineClosed,quarantineGeneration,
  priorDecision,disposableRecovery}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&H64.test(r184EvidenceSha256||'')&&
   Number.isSafeInteger(runId)&&runId>=10000&&
   quarantineClosed===true&&Number.isSafeInteger(quarantineGeneration)&&
   quarantineGeneration>=5&&
   priorDecision==='NO_GO_REAL_STAGING_EVIDENCE_PENDING',
   'source R184 NO-GO, exact run and closed quarantine prerequisite');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0&&
   Array.isArray(providerEvidence)&&providerEvidence.length===kinds.length,
   'bounded provider evidence and timestamp required');
  const seen=new Set(),normalized=[];
  for(const p of providerEvidence){
   ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
    keys(p)==='evidenceSha256,expiresAtMs,kind,mode,observedAtMs'&&
    kinds.includes(p.kind)&&!seen.has(p.kind)&&
    modes.has(p.mode)&&H64.test(p.evidenceSha256||'')&&
    Number.isSafeInteger(p.observedAtMs)&&
    Number.isSafeInteger(p.expiresAtMs)&&
    p.expiresAtMs>p.observedAtMs&&
    p.expiresAtMs-p.observedAtMs<=120000&&
    p.observedAtMs<=now&&now<=p.expiresAtMs,
    'untrusted, duplicated, inflated or expired provider evidence');
   seen.add(p.kind);
   normalized.push({
    kind:p.kind,mode:p.mode,evidenceSha256:p.evidenceSha256,
    observedAtMs:p.observedAtMs,expiresAtMs:p.expiresAtMs});
  }
  normalized.sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind));
  ok(kinds.every(x=>seen.has(x)),
   'all expected but unauthenticated provider surfaces required');
  const r=disposableRecovery;
  ok(r&&Object.getPrototypeOf(r)===Object.prototype&&
   keys(r)==='measuredRestoreMs,mode,syntheticExcludedEvents'&&
   r.mode==='DISPOSABLE_PG17'&&
   Number.isSafeInteger(r.measuredRestoreMs)&&
   r.measuredRestoreMs>=1&&r.measuredRestoreMs<=180000&&
   r.syntheticExcludedEvents===24,
   'real production recovery claims cannot enter synthetic evidence');
  const packet={
   schemaVersion:1,scope:'staging-readiness-diagnostic-only',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId,r184EvidenceSha256,
   providerEvidence:normalized,
   syntheticRecovery:{...r},
   blockers:tasks.map(x=>({...x})),
   blockedCount:tasks.length,quarantineClosed:true,
   quarantineGeneration,observedAtMs:now,expiresAtMs:now+60000,
   realProviderIndependentlyAttested:false,
   realHumansIndependentlyVerified:false,
   realStagingRecoveryVerified:false,
   realPilotAuthorized:false,productionAuthorized:false,
   decision:'NO_GO_ACTIONABLE_STAGING_REQUIREMENTS'
  };
  return Object.freeze({...packet,evidenceSha256:sha(packet)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,readOnly:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
