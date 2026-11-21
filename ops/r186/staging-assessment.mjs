/**
 * R186 source-bound actionable observation gate.
 *
 * Technical GitHub/HTTPS checks may pass, but actual IAM/SCP/KMS rights,
 * human independence, privacy and real recovery are not established here.
 * CI_SYNTHETIC checks DO NOT count as real readiness.
 * This has no GO code path and never opens R167 quarantine.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R186 staging assessment: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const witnessFields=['runId','sequence','nonce','sourceCommit',
 'r185EvidenceSha256','decision','productionAuthorized'];
const validWitness=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===witnessFields.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 H32.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
 H64.test(x.r185EvidenceSha256||'')&&
 x.decision==='NO_GO_STAGING_BLOCKERS_UNRESOLVED'&&
 x.productionAuthorized===false;
const same=(a,b)=>validWitness(a)&&validWitness(b)&&
 witnessFields.every(k=>a[k]===b[k]);
function verified(x){
 if(!x||Object.getPrototypeOf(x)!==Object.prototype)return false;
 const {evidenceSha256,...rest}=x;
 return H64.test(evidenceSha256||'')&&evidenceSha256===sha(rest);
}
export const R186_BLOCKER_CODES=Object.freeze([
 'REAL_GITHUB_HUMAN_APPROVALS',
 'STAGING_HTTPS_CONTRACT',
 'AWS_EFFECTIVE_PERMISSIONS',
 'STAGING_DATA_PRIVACY',
 'MEASURED_STAGING_RECOVERY'
]);
export function createR186StagingAssessment({
 readR185Hold,quarantine,clock=()=>Date.now(),allowInspect=false
}={}){
 ok(typeof readR185Hold==='function'&&
  typeof quarantine?.status==='function'&&typeof clock==='function',
  'real PostgreSQL17 source reader, quarantine and time required');
 async function inspect({commit,bundleSha256,r185Report,
  githubProof,httpsProof}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||''),'source-bound R186 assessment disabled');
  const before=await readR185Hold(),guard=await quarantine.status();
  ok(validWitness(before)&&before.sourceCommit===commit&&
   guard?.closed===true&&
   Number.isSafeInteger(guard.generation)&&guard.generation>=5,
   'R185 immutable NO-GO and closed quarantine required');
  const prior=r185Report?.hold;
  ok(r185Report?.schemaVersion===1&&
   r185Report.commit===commit&&r185Report.sourceBundleSha256===bundleSha256&&
   prior?.sourceCommit===commit&&prior.sourceBundleSha256===bundleSha256&&
   prior.runId===before.runId&&prior.sequence===before.sequence&&
   prior.nonce===before.nonce&&
   prior.evidenceSha256===before.r185EvidenceSha256&&
   prior.decision===before.decision&&
   prior.sourceMode==='CI_SYNTHETIC'&&
   prior.realPilotAuthorized===false&&prior.productionAuthorized===false&&
   verified(prior)&&
   r185Report.realPg17NativeRestoreAndAudit===true&&
   r185Report.realPg17RlsAndQuarantineRestored===true&&
   r185Report.realPg17ReplayDenied===true&&
   r185Report.syntheticProviderEvidenceOnly===true&&
   r185Report.syntheticCanaryOnly===true&&
   r185Report.realProviderVerified===false&&
   r185Report.realProductionRecoveryVerified===false&&
   r185Report.realPilotAuthorized===false&&
   r185Report.productionAuthorized===false,
   'R185 CI provenance or immutable source evidence altered');
  const t=clock();
  const acceptedModes=['CI_SYNTHETIC','OPERATOR_READONLY_UNATTESTED'];
  ok(Number.isSafeInteger(t)&&
   githubProof?.sourceCommit===commit&&
   githubProof?.sourceBundleSha256===bundleSha256&&
   githubProof.repository==='osmanosmanov6880-bot/marcosa-fusion'&&
   githubProof.pullRequest===168&&
   githubProof.headMatchesReviewedCheckout===true&&
   githubProof.historyComplete===true&&
   Number.isSafeInteger(githubProof.observedPrReviewEvents)&&
   githubProof.observedPrReviewEvents>=0&&
   Number.isSafeInteger(githubProof.currentHeadUniqueApprovals)&&
   githubProof.currentHeadUniqueApprovals>=0&&
   githubProof.currentHeadUniqueApprovals<=400&&
   Number.isSafeInteger(githubProof.currentHeadUnresolvedChanges)&&
   githubProof.currentHeadUnresolvedChanges>=0&&
   acceptedModes.includes(githubProof.sourceMode)&&
   githubProof.realHumanIdentityIndependentlyAttested===false&&
   githubProof.realGitHubDeploymentAuthorizationVerified===false&&
   githubProof.actualDeploymentAttempted===false&&
   githubProof.productionAuthorized===false&&
   githubProof.realPilotAuthorized===false&&
   t>=githubProof.observedAtMs&&t<=githubProof.expiresAtMs&&
   githubProof.expiresAtMs-githubProof.observedAtMs===60000&&
   verified(githubProof),
   'GitHub preflight source, complete history, TTL or nonpromotion invalid');
  ok(httpsProof?.sourceCommit===commit&&
   httpsProof?.sourceBundleSha256===bundleSha256&&
   httpsProof.scope==='explicit-staging-readonly-health'&&
   acceptedModes.includes(httpsProof.sourceMode)&&
   httpsProof.sourceMode===githubProof.sourceMode&&
   /^staging\./.test(httpsProof.hostname||'')&&
   httpsProof.readOnlyRequests===3&&
   Array.isArray(httpsProof.checks)&&httpsProof.checks.length===3&&
   ['HEALTH','READY','SECURITY_HEADERS'].every((name,i)=>
    httpsProof.checks[i].name===name&&
    typeof httpsProof.checks[i].passed==='boolean'&&
    typeof httpsProof.checks[i].reason==='string')&&
   httpsProof.healthAndSecurityPassed===
    httpsProof.checks.every(x=>x.passed===true)&&
   httpsProof.noRedirectsFollowed===true&&
   httpsProof.noCredentialsSent===true&&
   httpsProof.responseBodiesRetained===false&&
   httpsProof.customerRecordsRead===false&&
   httpsProof.actualDeploymentAttempted===false&&
   httpsProof.externalTlsIdentityIndependentlyAttested===false&&
   httpsProof.realPilotAuthorized===false&&
   httpsProof.productionAuthorized===false&&
   t>=httpsProof.observedAtMs&&t<=httpsProof.expiresAtMs&&
   httpsProof.expiresAtMs-httpsProof.observedAtMs===60000&&
   verified(httpsProof),
   'HTTPS source, health metrics or read-only provenance invalid');
  const operator=githubProof.sourceMode==='OPERATOR_READONLY_UNATTESTED';
  const prLooksReady=githubProof.verifiedSignedCommit===true&&
   githubProof.currentHeadUniqueApprovals>=2&&
   githubProof.currentHeadUnresolvedChanges===0&&
   githubProof.githubEnvironmentConfigured===true&&
   githubProof.environmentReviewProtectionConfigured===true;
  const stagingLooksReady=httpsProof.healthAndSecurityPassed===true;
  // These only count as OBSERVED, not independently authorized by humans.
  const checks=[
   {code:R186_BLOCKER_CODES[0],state:operator&&prLooksReady?
    'OBSERVED_PENDING_INDEPENDENT_IDENTITY':'BLOCKED',
    next:'Collect and independently verify actual GitHub PR/environment reviewers on this SHA'},
   {code:R186_BLOCKER_CODES[1],state:operator&&stagingLooksReady?
    'OBSERVED_PENDING_EXTERNAL_TLS_ATTESTATION':'BLOCKED',
    next:'Verify TLS identity and anonymous staging /health, /ready and headers outside CI'},
   {code:R186_BLOCKER_CODES[2],state:'BLOCKED',
    next:'Independently inspect AWS identity, SCP, KMS and resource-effective permissions'},
   {code:R186_BLOCKER_CODES[3],state:'BLOCKED',
    next:'Review permitted staging data handling, retention, logging and anonymization'},
   {code:R186_BLOCKER_CODES[4],state:'BLOCKED',
    next:'Measure authorized staging fault/restore recovery and verify rollback'}
  ];
  const after=await readR185Hold(),q=await quarantine.status();
  ok(same(before,after)&&q?.closed===true&&
   q.generation===guard.generation,
   'R185 source or quarantine changed during read-only assessment');
  const record={
   schemaVersion:1,scope:'read-only-staging-observation-hold',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:before.runId,sequence:before.sequence,nonce:before.nonce,
   r185EvidenceSha256:before.r185EvidenceSha256,
   githubEvidenceSha256:githubProof.evidenceSha256,
   httpsEvidenceSha256:httpsProof.evidenceSha256,
   sourceMode:githubProof.sourceMode,stagingHostname:httpsProof.hostname,
   checks,hardBlockingChecks:5,
   githubPrCurrentHeadApprovalsObserved:githubProof.currentHeadUniqueApprovals,
   githubEnvironmentReviewerRuleObserved:
    githubProof.environmentReviewProtectionConfigured,
   stagingHttpAllChecksObservedPassed:stagingLooksReady,
   realGitHubHumanIdentityVerified:false,
   realAwsEffectivePermissionsVerified:false,
   realTlsIdentityIndependentlyVerified:false,
   stagingPrivacyIndependentlyVerified:false,
   realStagingRpoRtoVerified:false,
   quarantineClosed:true,quarantineGeneration:q.generation,
   decision:'NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING',
   realPilotAuthorized:false,productionAuthorized:false,
   observedAtMs:clock()
  };
  return Object.freeze({...record,evidenceSha256:sha(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,readOnly:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
