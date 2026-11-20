/**
 * R188 bound ephemeral signed transcript + dual-store PG17 retention witness.
 * Positive cryptographic checks remain synthetic and cannot authorize a
 * real deployment, real human approval, or real GDPR compliance.
 */
import {createHash} from 'node:crypto';
import {verifyR188SignedTranscript} from './signed-transcript.mjs';
const fail=m=>{throw Error('R188 staging gate: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fields=['runId','sequence','nonce','sourceCommit',
 'r187EvidenceSha256','decision','productionAuthorized'];
function valid(x){
 return x&&Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
  Number.isSafeInteger(x.runId)&&x.runId>=10000&&
  Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
  H32.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
  H64.test(x.r187EvidenceSha256||'')&&
  x.decision==='NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
  x.productionAuthorized===false;
}
const equal=(x,y)=>valid(x)&&valid(y)&&fields.every(k=>x[k]===y[k]);
const verified=p=>{
 if(!p||Object.getPrototypeOf(p)!==Object.prototype)return false;
 const {evidenceSha256,...rest}=p;
 return H64.test(evidenceSha256||'')&&evidenceSha256===hash(rest);
};
export function createR188StagingGate({
 readR187Hold,quarantine,clock=()=>Date.now(),allowInspect=false
}={}){
 ok(typeof readR187Hold==='function'&&
  typeof quarantine?.status==='function'&&typeof clock==='function',
  'real native R187 source read and quarantine must exist');
 async function inspect({commit,bundleSha256,r187Report,retentionProof,
  transcriptBytes,transcriptFileSha256}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||''),'explicit source-pinned R188 check required');
  const prior=await readR187Hold(),q=await quarantine.status();
  ok(valid(prior)&&prior.sourceCommit===commit&&
   q?.closed===true&&Number.isSafeInteger(q.generation)&&q.generation>=5,
   'native R187 immutable NO-GO/quarantine missing');
  const p=r187Report?.finalHold;
  ok(r187Report?.schemaVersion===1&&r187Report.commit===commit&&
   r187Report.sourceBundleSha256===bundleSha256&&
   p?.sourceCommit===commit&&p.sourceBundleSha256===bundleSha256&&
   p.runId===prior.runId&&p.sequence===prior.sequence&&
   p.nonce===prior.nonce&&
   p.decision===prior.decision&&
   p.evidenceSha256===prior.r187EvidenceSha256&&
   p.realPilotAuthorized===false&&p.productionAuthorized===false&&
   verified(p)&&r187Report.realPg17RetentionDeletedFour===true&&
   r187Report.realPg17EightActiveRetained===true&&
   r187Report.realPg17HoldAndAuditRestored===true&&
   r187Report.realPg17ReplayDenied===true&&
   r187Report.syntheticDnsAndHttps===true&&
   r187Report.syntheticEd25519Identities===true&&
   r187Report.realHumanIdentityVerified===false&&
   r187Report.realTlsIdentityAttested===false&&
   r187Report.realAwsEffectiveRightsVerified===false&&
   r187Report.realPrivacyComplianceVerified===false&&
   r187Report.realPilotAuthorized===false&&
   r187Report.productionAuthorized===false,
   'R187 source ancestry or CI-only evidence has changed');
  const rv=retentionProof;
  ok(rv?.sourceCommit===commit&&
   rv.sourceBundleSha256===bundleSha256&&
   rv.runId===prior.runId&&
   rv.r187EvidenceSha256===prior.r187EvidenceSha256&&
   rv.retentionReceiptSha256===r187Report.retentionProof?.evidenceSha256&&
   rv.sourceRows===8&&rv.restoredRows===8&&
   rv.expiredRowsMissing===4&&
   rv.nativeForceRlsOnBothCopies===true&&
   rv.publicSelectDeniedOnBothCopies===true&&
   rv.quarantineRemainsClosed===true&&
   rv.realRetentionComplianceVerified===false&&
   rv.realPilotAuthorized===false&&rv.productionAuthorized===false&&
   rv.decision==='NO_GO_READONLY_SYNTHETIC_RETENTION'&&
   verified(rv),
   'native PostgreSQL retention comparison or hash invalid');
  const signature=verifyR188SignedTranscript({
   bytes:transcriptBytes,commit,bundleSha256,
   expectedFileSha256:transcriptFileSha256});
  const body=JSON.parse(transcriptBytes.toString('utf8'));
  ok(signature.verified===true&&signature.signerCount===2&&
   signature.runId===prior.runId&&
   body.packet.githubEvidenceSha256===
    r187Report.r186Report?.githubProof?.evidenceSha256&&
   body.packet.httpsEvidenceSha256===
    r187Report.tlsProof?.httpsEvidenceSha256&&
   body.scope==='ephemeral-ci-ed25519-portable-no-go'&&
   body.independentlyVerifiedHumanIdentity===false&&
   body.realPilotAuthorized===false&&body.productionAuthorized===false,
   'independent Ed25519 transcript source/binding invalid');
  const later=await readR187Hold(),q2=await quarantine.status();
  ok(equal(prior,later)&&q2?.closed===true&&
   q2.generation===q.generation,
   'native predecessor or quarantine changed during attestation');
  const time=clock();
  ok(Number.isSafeInteger(time)&&time>0,
   'bounded trustworthy evaluation time required');
  const out={
   schemaVersion:1,scope:'native-pg17-source-bound-r188-no-go',
   sourceMode:'CI_SYNTHETIC',
   decision:'NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:prior.runId,sequence:prior.sequence,nonce:prior.nonce,
   r187EvidenceSha256:prior.r187EvidenceSha256,
   retentionEvidenceSha256:rv.evidenceSha256,
   transcriptSha256:body.transcriptSha256,
   transcriptFileSha256,syntheticVerifiedSignatures:2,
   sourceRemainingRows:8,restoredRemainingRows:8,
   expiredRowsAbsent:4,nativeForceRlsVerified:true,
   quarantineClosed:true,quarantineGeneration:q2.generation,
   humanIdentitiesIndependentlyVerified:false,
   stagingTlsIdentityIndependentlyVerified:false,
   effectiveAwsPermissionsVerified:false,
   livePrivacyComplianceVerified:false,
   realStagingRecoveryVerified:false,
   realPilotAuthorized:false,productionAuthorized:false,
   observedAtMs:time
  };
  return Object.freeze({...out,evidenceSha256:hash(out)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,readOnly:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
