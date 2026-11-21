/**
 * R181 combine real read-only observations with R180 immutable hold.
 * Still NO-GO: verified API response shapes and two reviewer events alone
 * cannot prove independent humans, effective permissions, privacy/RPO/RTO.
 * No deployment, release promotion, quarantine reopening or production action.
 */
import {createHash} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R181 staging evaluator: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const witnessKeys=['runId','sequence','nonce','sourceCommit',
 'classificationSha256','quorumReceiptSha256','decision','productionAuthorized'];
function valid(w){
 return w&&Object.getPrototypeOf(w)===Object.prototype&&
  Object.keys(w).sort().join(',')===witnessKeys.slice().sort().join(',')&&
  Number.isSafeInteger(w.runId)&&w.runId>=10000&&
  Number.isSafeInteger(w.sequence)&&w.sequence>=2&&w.sequence<=32&&
  H32.test(w.nonce||'')&&H40.test(w.sourceCommit||'')&&
  H64.test(w.classificationSha256||'')&&
  H64.test(w.quorumReceiptSha256||'')&&
  w.decision==='NO_GO_EXTERNAL_EVIDENCE_PENDING'&&
  w.productionAuthorized===false;
}
const same=(a,b)=>valid(a)&&valid(b)&&
 witnessKeys.every(k=>a[k]===b[k]);
export function createR181StagingEvaluator({readR180Hold,quarantine,
 githubInspector,awsInspector,clock=()=>Date.now(),
 allowInspect=false}={}){
 ok(typeof readR180Hold==='function'&&
  quarantine&&typeof quarantine.status==='function'&&
  githubInspector&&typeof githubInspector.inspect==='function'&&
  awsInspector&&typeof awsInspector.inspect==='function'&&
  typeof clock==='function','exact independently reread PG17 hold and two provider inspectors required');
 async function inspect({commit,bundleSha256,historyRootSha256,
  sha256,sourceVersionId,offsiteVersionId,sourceMode='CI_SYNTHETIC'}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&
   [bundleSha256,historyRootSha256,sha256].every(x=>H64.test(x||''))&&
   ['CI_SYNTHETIC','MANUAL_READONLY'].includes(sourceMode),
   'explicit read-only scope and pinned source/crypto required');
  const before=await readR180Hold();
  const qBefore=await quarantine.status();
  ok(valid(before)&&before.sourceCommit===commit&&
   qBefore?.closed===true&&Number.isSafeInteger(qBefore.generation)&&
   qBefore.generation>=5,
   'R180 immutable NO-GO and closed quarantine required');
  const [github,aws]=await Promise.all([
   githubInspector.inspect(),
   awsInspector.inspect({commit,bundleSha256,historyRootSha256,
    sha256,sourceVersionId,offsiteVersionId})
  ]);
  const now=clock();
  ok(github?.schemaVersion===1&&github.commit===commit&&
   github.runId===before.runId&&
   github.twoDistinctReviewEventsShapeMatched===true&&
   github.exactProtectedBranchInspected===true&&
   github.preventSelfReviewConfigured===true&&
   github.providerIdentityIndependentlyAuthenticated===false&&
   github.twoNaturalPersonsIndependentlyVerified===false&&
   github.productionAuthorized===false&&
   H64.test(github.evidenceSha256||'')&&
   now>=github.checkedAtMs&&now<=github.expiresAtMs&&
   aws?.schemaVersion===1&&aws.commit===commit&&
   aws.bundleSha256===bundleSha256&&
   aws.historyRootSha256===historyRootSha256&&
   aws.sha256===sha256&&
   aws.sourceVersionId===sourceVersionId&&
   aws.offsiteVersionId===offsiteVersionId&&
   aws.pinnedReadOnlyProfilesObserved===true&&
   aws.fullTwoAccountVersionReadbackShapeMatched===true&&
   aws.independentProviderAttestation===false&&
   aws.productionAuthorized===false&&
   H64.test(aws.evidenceSha256||'')&&
   now>=aws.checkedAtMs&&now<=aws.expiresAtMs,
   'live-readonly GitHub policy/API or AWS exact-version evidence missing');
  const after=await readR180Hold();
  const qAfter=await quarantine.status();
  ok(same(before,after)&&qAfter?.closed===true&&
   qAfter.generation===qBefore.generation,
   'R180 NO-GO or source quarantine moved during external inspection');
  const record={
   schemaVersion:1,scope:'isolated-staging-readonly-observation',
   sourceMode,sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId:before.runId,sequence:before.sequence,nonce:before.nonce,
   classificationSha256:before.classificationSha256,
   quorumReceiptSha256:before.quorumReceiptSha256,
   historyRootSha256,probeSha256:sha256,
   sourceAccountId:aws.sourceAccountId,
   offsiteAccountId:aws.offsiteAccountId,
   githubEvidenceSha256:github.evidenceSha256,
   awsEvidenceSha256:aws.evidenceSha256,
   actualIndependentProviderAttestation:false,
   naturalPersonSeparationIndependentlyVerified:false,
   restoreRpoRtoAndPrivacyVerified:false,
   quarantineRemainsClosed:true,
   decision:'NO_GO_PROVIDER_ATTESTATION_PENDING',
   productionAuthorized:false,
   observedAtMs:now
  };
  return Object.freeze({...record,evidenceSha256:sha(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowInspect,readOnly:true,
  productionAuthorized:false,automaticDeployment:false})});
}
