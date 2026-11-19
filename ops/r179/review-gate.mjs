/**
 * R179 orchestrated read-only review evidence from:
 * - R178 native PostgreSQL staging attestation, twice
 * - GitHub manual workflow review-history API (synthetic in CI)
 * - S3 exact-version replication metadata (synthetic in CI)
 * Never promotes the read-only staging simulation to production.
 */
import {createHash} from 'node:crypto';
import {verifyR179GithubApprovalProof} from './github-approval-audit.mjs';
import {verifyR179ReplicationProof} from './replication-provenance.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R179 review gate: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const WITNESS_FIELDS=['sequence','nonce','commit','rootSha256',
 'archiveSha256','restoredStateSha256','probeSha256',
 'sourceAccountId','offsiteAccountId','evidenceSha256',
 'productionAuthorized'];
const equal=(a,b)=>a&&b&&WITNESS_FIELDS.every(k=>a[k]===b[k]);
function valid(x){
 return x&&Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).sort().join(',')===WITNESS_FIELDS.slice().sort().join(',')&&
  Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
  H32.test(x.nonce||'')&&H40.test(x.commit||'')&&
  ['rootSha256','archiveSha256','restoredStateSha256',
   'probeSha256','evidenceSha256'].every(k=>H64.test(x[k]||''))&&
  /^\d{12}$/.test(x.sourceAccountId||'')&&
  /^\d{12}$/.test(x.offsiteAccountId||'')&&
  x.sourceAccountId!==x.offsiteAccountId&&x.productionAuthorized===false;
}
function r178Bound(p,w){
 const {decision,evidenceSha256,...manifest}=p||{};
 return p?.schemaVersion===1&&
  p.scope==='isolated-read-only-staging-simulation'&&
  decision==='CI_SIMULATION_COMPLETE'&&
  p.syntheticCiScopeOnly===true&&
  p.productionAuthorized===false&&
  p.realIamPolicyApplied===false&&
  p.actualAwsAccountsIndependentlyVerified===false&&
  p.humanApprovalVerified===false&&p.verifiedPg17ReadbackTwice===true&&
  p.commit===w.commit&&p.sequence===w.sequence&&
  p.nonce===w.nonce&&p.archiveSha256===w.archiveSha256&&
  p.historyRootSha256===w.rootSha256&&
  p.restoredStateSha256===w.restoredStateSha256&&
  p.probeSha256===w.probeSha256&&
  p.sourceAccountId===w.sourceAccountId&&
  p.offsiteAccountId===w.offsiteAccountId&&
  p.evidenceSha256===w.evidenceSha256&&
  digest(manifest)===p.evidenceSha256;
}
export function createR179ReviewGate({readR178Witness,
 githubAudit,replicationAudit,clock=()=>Date.now(),
 allowEvaluate=false}={}){
 ok(typeof readR178Witness==='function'&&
  githubAudit&&typeof githubAudit.inspect==='function'&&
  replicationAudit&&typeof replicationAudit.inspect==='function'&&
  typeof clock==='function','two externally backed auditors and real PG17 R178 witness required');
 async function inspect({r178Proof,runId,actorId,
  commit,bundleSha256,historyRootSha256,probeSha256,
  sourceVersionId,offsiteVersionId}={}){
  ok(allowEvaluate===true,'R179 staging review network disabled');
  ok(H40.test(commit||'')&&
   [bundleSha256,historyRootSha256,probeSha256].every(x=>H64.test(x||''))&&
   Number.isSafeInteger(runId)&&runId>=10000&&
   Number.isSafeInteger(actorId)&&actorId>0,
   'pinned manual GitHub run and cryptographic source required');
  const before=await readR178Witness();
  ok(valid(before)&&r178Bound(r178Proof,before)&&
   before.commit===commit&&before.rootSha256===historyRootSha256&&
   before.probeSha256===probeSha256&&
   r178Proof.bundleSha256===bundleSha256,
   'native PG17 R178 source-bound staging witness missing');
  const [github,replica]=await Promise.all([
   githubAudit.inspect(),replicationAudit.inspect({
    r178Proof:{...r178Proof,verified:true,
     archiveSha256:probeSha256},
    commit,bundleSha256,historyRootSha256,sha256:probeSha256,
    sourceVersionId,offsiteVersionId
   })
  ]);
  verifyR179GithubApprovalProof(github,{commit,runId,actorId,clock});
  verifyR179ReplicationProof(replica,{commit,bundleSha256,
   historyRootSha256,
   sourceAccountId:before.sourceAccountId,
   offsiteAccountId:before.offsiteAccountId,clock});
  ok(replica.sourceVersionId===sourceVersionId&&
   replica.offsiteVersionId===offsiteVersionId&&
   replica.sha256===probeSha256&&
   github.productionAuthorized===false&&replica.productionAuthorized===false,
   'AWS provider or GitHub approval replaced during staging readback');
  const after=await readR178Witness();
  ok(valid(after)&&equal(before,after),
   'immutable R178 native staging evidence changed during external checks');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,
   'trusted decision timestamp required');
  const record={
   schemaVersion:1,scope:'isolated-staging-review-simulation',
   decision:'CI_SIMULATED_REVIEW_ONLY',
   commit,bundleSha256,sequence:before.sequence,nonce:before.nonce,
   archiveSha256:before.archiveSha256,
   historyRootSha256,restoredStateSha256:before.restoredStateSha256,
   probeSha256,sourceAccountId:before.sourceAccountId,
   offsiteAccountId:before.offsiteAccountId,runId,actorId,
   r178EvidenceSha256:before.evidenceSha256,
   githubEvidenceSha256:github.evidenceSha256,
   replicationEvidenceSha256:replica.evidenceSha256,
   githubReviewEventsShapeValid:true,replicationStatusShapeValid:true,
   actualHumanApprovalsVerified:false,realAwsDeliveryVerified:false,
   actualGitHubProviderIndependentlyVerified:false,
   productionAuthorized:false
  };
  return Object.freeze({...record,evidenceSha256:digest(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,enabled:allowEvaluate,productionAuthorized:false})});
}
