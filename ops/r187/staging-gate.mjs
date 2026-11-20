/**
 * R187 diagnostic-only source-bound evidence gate. Two correctly verified
 * Ed25519 signatures over a short-lived NO-GO packet are NOT an independent
 * human identity or staging deployment approval.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R187 staging gate: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fields=['runId','sequence','nonce','sourceCommit',
 'r186EvidenceSha256','decision','productionAuthorized'];
const valid=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 H32.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
 H64.test(x.r186EvidenceSha256||'')&&
 x.decision==='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'&&
 x.productionAuthorized===false;
const same=(a,b)=>valid(a)&&valid(b)&&fields.every(k=>a[k]===b[k]);
const proofHash=p=>{
 if(!p||Object.getPrototypeOf(p)!==Object.prototype)return false;
 const{evidenceSha256,...raw}=p;
 return H64.test(evidenceSha256||'')&&
  evidenceSha256===sha(raw);
};
export function createR187StagingGate({readR186Hold,quarantine,
 clock=()=>Date.now(),allowInspect=false}={}){
 ok(typeof readR186Hold==='function'&&
  typeof quarantine?.status==='function'&&
  typeof clock==='function','native immutable R186 and quarantine readback required');
 async function inspect({commit,bundleSha256,r186Report,
  retentionProof,dualAttestationProof,tlsProof}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||''),
   'explicit staging-readiness verification required');
  const before=await readR186Hold(),q=await quarantine.status();
  ok(valid(before)&&before.sourceCommit===commit&&
   q?.closed===true&&Number.isSafeInteger(q.generation)&&q.generation>=5,
   'closed source NO-GO and native quarantine missing');
  const prior=r186Report?.assessment;
  ok(r186Report?.schemaVersion===1&&r186Report.commit===commit&&
   r186Report.sourceBundleSha256===bundleSha256&&
   prior?.sourceCommit===commit&&
   prior.sourceBundleSha256===bundleSha256&&
   prior.runId===before.runId&&prior.sequence===before.sequence&&
   prior.nonce===before.nonce&&
   prior.r185EvidenceSha256===r186Report.r185Report?.hold?.evidenceSha256&&
   prior.evidenceSha256===before.r186EvidenceSha256&&
   prior.decision===before.decision&&
   prior.sourceMode==='CI_SYNTHETIC'&&
   prior.realPilotAuthorized===false&&
   prior.productionAuthorized===false&&proofHash(prior)&&
   r186Report.realPg17RestoreRlsAndAudit===true&&
   r186Report.realPg17ReplayDenied===true&&
   r186Report.syntheticGithubApiOnly===true&&
   r186Report.syntheticHttpsTransportOnly===true&&
   r186Report.realGithubHumanApprovalsVerified===false&&
   r186Report.realHttpsTlsIndependentlyAttested===false&&
   r186Report.realAwsEffectiveRightsVerified===false&&
   r186Report.realPilotAuthorized===false&&
   r186Report.productionAuthorized===false,
   'R186 source ancestry or synthetic provider claims promoted');
  const at=clock();
  ok(Number.isSafeInteger(at)&&at>0&&
   retentionProof?.sourceCommit===commit&&
   retentionProof.sourceBundleSha256===bundleSha256&&
   retentionProof.runId===before.runId&&
   retentionProof.sequence===before.sequence&&
   retentionProof.nonce===before.nonce&&
   retentionProof.r186EvidenceSha256===before.r186EvidenceSha256&&
   retentionProof.scope==='disposable-pg17-synthetic-retention-only'&&
   retentionProof.syntheticRowsBefore===12&&
   retentionProof.syntheticExpiredRowsDeleted===4&&
   retentionProof.syntheticActiveRowsRemaining===8&&
   retentionProof.rawCustomerDataProcessed===false&&
   retentionProof.liveRetentionPolicyEnforced===false&&
   retentionProof.realPrivacyComplianceAttested===false&&
   retentionProof.quarantineClosed===true&&
   retentionProof.productionAuthorized===false&&
   retentionProof.decision==='NO_GO_SYNTHETIC_RETENTION_ONLY'&&
   proofHash(retentionProof),
   'source-bound native PG17 synthetic retention evidence invalid');
  ok(dualAttestationProof?.sourceCommit===commit&&
   dualAttestationProof.bundleSha256===bundleSha256&&
   dualAttestationProof.runId===before.runId&&
   dualAttestationProof.githubEvidenceSha256===
    r186Report.githubProof?.evidenceSha256&&
   dualAttestationProof.httpsEvidenceSha256===
    r186Report.httpsProof?.evidenceSha256&&
   dualAttestationProof.scope==='two-distinct-ed25519-keys-no-go'&&
   dualAttestationProof.cryptographicSignaturesValid===true&&
   Array.isArray(dualAttestationProof.signers)&&
   dualAttestationProof.signers.length===2&&
   dualAttestationProof.signers[0].role==='PR_REVIEW'&&
   dualAttestationProof.signers[1].role==='SECURITY_REVIEW'&&
   dualAttestationProof.signers[0].signerId!==
    dualAttestationProof.signers[1].signerId&&
   dualAttestationProof.signers[0].publicKeyFingerprintSha256!==
    dualAttestationProof.signers[1].publicKeyFingerprintSha256&&
   dualAttestationProof.independentHumanIdentityEstablished===false&&
   dualAttestationProof.githubEnvironmentAuthorizationVerified===false&&
   dualAttestationProof.externalKeyRegistryAttested===false&&
   dualAttestationProof.realPilotAuthorized===false&&
   dualAttestationProof.productionAuthorized===false&&
   dualAttestationProof.decision===
    'NO_GO_MANUAL_IDENTITY_ATTESTATION_PENDING'&&
   proofHash(dualAttestationProof),
   'two cryptographically checked Ed25519 receipt hashes missing/promoted');
  ok(tlsProof?.sourceCommit===commit&&
   tlsProof.sourceBundleSha256===bundleSha256&&
   tlsProof.runId===before.runId&&
   tlsProof.sourceMode==='CI_SYNTHETIC'&&
   tlsProof.httpsEvidenceSha256===r186Report.httpsProof?.evidenceSha256&&
   tlsProof.stagingHostname===prior.stagingHostname&&
   tlsProof.acceptedGlobalIpv4Addresses>=1&&
   tlsProof.acceptedGlobalIpv4Addresses<=8&&
   tlsProof.readOnlyPinnedRequests===3&&
   H64.test(tlsProof.pinnedAddressSetSha256||'')&&
   tlsProof.dnssecVerified===false&&
   tlsProof.externalTlsIdentityIndependentlyAttested===false&&
   tlsProof.peerCertificateIndependentlyReviewed===false&&
   tlsProof.realPilotAuthorized===false&&
   tlsProof.productionAuthorized===false&&
   tlsProof.decision==='NO_GO_TLS_IDENTITY_INDEPENDENTLY_UNVERIFIED'&&
   proofHash(tlsProof),
   'source-bound synthetic DNS pinning is not independent TLS proof');
  const after=await readR186Hold(),q2=await quarantine.status();
  ok(same(before,after)&&q2?.closed===true&&
   q2.generation===q.generation,
   'native source quarantine changed or R186 high-water moved');
  const record={
   schemaVersion:1,scope:'r187-native-pg17-synthetic-hold',
   sourceMode:'CI_SYNTHETIC',
   decision:'NO_GO_REAL_STAGING_ATTESTATION_PENDING',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:before.runId,sequence:before.sequence,nonce:before.nonce,
   r186EvidenceSha256:before.r186EvidenceSha256,
   retentionEvidenceSha256:retentionProof.evidenceSha256,
   dualAttestationEvidenceSha256:dualAttestationProof.evidenceSha256,
   tlsPinEvidenceSha256:tlsProof.evidenceSha256,
   syntheticExpiredRowsDeleted:4,syntheticActiveRowsRemaining:8,
   verifiedSyntheticSignatures:2,
   stagingHostname:tlsProof.stagingHostname,
   sourceQuarantineClosed:true,
   humanIdentitiesIndependentlyVerified:false,
   tlsIdentityIndependentlyVerified:false,
   awsEffectiveRightsVerified:false,
   productionPrivacyVerified:false,
   realStagingRpoRtoVerified:false,
   realPilotAuthorized:false,productionAuthorized:false,
   observedAtMs:at
  };
  return Object.freeze({...record,evidenceSha256:sha(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,sourceBound:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
