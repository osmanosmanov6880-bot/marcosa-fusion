/**
 * R178 read-only staging evidence gate. An authentic R177 PG17 restore
 * outcome is required before inspecting two injected AWS STS and S3 clients.
 * Freshness and post-readback R174/R177 high-water MUST be identical.
 * This never grants deployment, production or actual AWS authority.
 */
import {createHash} from 'node:crypto';
import {verifyR178IdentityProof} from './identity-audit.mjs';
import {verifyR178ReadOnlyIamBlueprint} from './iam-plan.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R178 readiness gate: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=['sequence','commit','bundleSha256','archiveSha256',
 'checkpointSha256','historyRootSha256','latestObjectSha256',
 'nonce','restoredStateSha256','productionAuthorized'];
function validRead(x){
 return x&&Number.isSafeInteger(x.sequence)&&x.sequence>=2&&
  x.sequence<=32&&H40.test(x.commit||'')&&H32.test(x.nonce||'')&&
  ['bundleSha256','archiveSha256','checkpointSha256',
   'historyRootSha256','latestObjectSha256','restoredStateSha256']
   .every(k=>H64.test(x[k]||''))&&x.productionAuthorized===false&&
  Object.keys(x).sort().join(',')===fields.slice().sort().join(',');
}
const identical=(a,b)=>validRead(a)&&validRead(b)&&
 fields.every(k=>a[k]===b[k]);
export function createR178ReadinessGate({readPostgres,
 identityAudit,replicaAudit,iamBlueprint,source,offsite,
 clock=()=>Date.now(),allowEvaluate=false}={}){
 ok(typeof readPostgres==='function'&&
  identityAudit&&typeof identityAudit.inspect==='function'&&
  replicaAudit&&typeof replicaAudit.inspect==='function'&&
  iamBlueprint&&source&&offsite&&typeof clock==='function',
  'independent R177 PG17, source/offsite clients and fixed IAM blueprint required');
 const plan=verifyR178ReadOnlyIamBlueprint(iamBlueprint,{source,offsite});
 async function inspect({commit,bundleSha256,historyRootSha256,
  probeSha256,sourceVersionId,offsiteVersionId}={}){
  ok(allowEvaluate===true,'read-only staging evaluation disabled by default');
  ok(H40.test(commit||'')&&
   [bundleSha256,historyRootSha256,probeSha256].every(x=>H64.test(x||'')),
   'only pinned source checkout, R177 history root and ciphertext probe');
  const initial=await readPostgres();
  ok(validRead(initial)&&initial.commit===commit&&
   initial.bundleSha256===bundleSha256&&
   initial.historyRootSha256===historyRootSha256,
   'independent R177 outcome, R174 high-water and archive binding missing');
  const identity=await identityAudit.inspect();
  verifyR178IdentityProof(identity,{commit,bundleSha256,
   sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
   clock});
  const replica=await replicaAudit.inspect({
   sha256:probeSha256,sourceVersionId,offsiteVersionId,
   commit,bundleSha256,historyRootSha256
  });
  const now=clock();
  ok(replica?.verified===true&&replica.schemaVersion===1&&
   replica.commit===commit&&replica.bundleSha256===bundleSha256&&
   replica.historyRootSha256===historyRootSha256&&
   replica.archiveSha256===probeSha256&&
   replica.sourceAccountId===identity.sourceAccountId&&
   replica.offsiteAccountId===identity.offsiteAccountId&&
   replica.sourceVersionId===sourceVersionId&&
   replica.offsiteVersionId===offsiteVersionId&&
   replica.sourceBucket===source.bucket&&replica.offsiteBucket===offsite.bucket&&
   replica.sourceKmsKeyArn===source.kmsKeyArn&&
   replica.offsiteKmsKeyArn===offsite.kmsKeyArn&&
   replica.bothFullCiphertextSha256Verified===true&&
   replica.twoAccountsAndRegionsConfigured===true&&
   replica.independentProviderCredentialsProven===false&&
   replica.actualCrossAccountReplicaDeliveryProven===false&&
   replica.productionAuthorized===false&&
   Number.isSafeInteger(now)&&now>=replica.observedAtMs&&
   now<=replica.expiresAtMs&&
   replica.expiresAtMs-replica.observedAtMs===60000,
   'cross-account encrypted probe, pinned immutable version or KMS ID failed');
  const final=await readPostgres();
  ok(identical(initial,final),'native R174 or R177 changed during AWS inspection');
  const proof={
   schemaVersion:1,scope:'isolated-read-only-staging-simulation',
   commit,bundleSha256,sequence:initial.sequence,
   archiveSha256:initial.archiveSha256,
   checkpointSha256:initial.checkpointSha256,
   historyRootSha256,latestObjectSha256:initial.latestObjectSha256,
   restoredStateSha256:initial.restoredStateSha256,
   nonce:initial.nonce,probeSha256,
   sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
   sourceVersionId,offsiteVersionId,
   identityEvidenceSha256:identity.evidenceSha256,
   iamPlanSha256:plan.planSha256,
   replicaEvidenceSha256:hash(replica),
   verifiedPg17ReadbackTwice:true,
   syntheticCiScopeOnly:true,realIamPolicyApplied:false,
   humanApprovalVerified:false,actualAwsAccountsIndependentlyVerified:false,
   productionAuthorized:false
  };
  return Object.freeze({...proof,
   evidenceSha256:hash(proof),decision:'CI_SIMULATION_COMPLETE'});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowEvaluate,productionAuthorized:false,
  actualRealAwsAccountUsed:false})});
}
