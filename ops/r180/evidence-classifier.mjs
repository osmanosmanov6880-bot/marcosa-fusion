/**
 * R180: classify the *actual* R179 CI report without turning mock AWS or
 * GitHub responses into a claim of provider or human verification.
 * Immutable source-bound NO-GO summary is the only possible decision.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R180 evidence classifier: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const rawSha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function stable(x){
 if(Array.isArray(x))return x.map(stable);
 if(x&&typeof x==='object')return Object.fromEntries(
  Object.keys(x).sort().map(k=>[k,stable(x[k])]));
 return x;
}
const sha=x=>rawSha(stable(x));
const eq=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const keys=x=>Object.keys(x||{}).sort().join(',');
const reportKeys=[
 'schemaVersion','commit','sourceBundleSha256','historyRootSha256',
 'sourceAccountId','offsiteAccountId','reviewEvidenceSha256',
 'reviewProof','realPg17ImmutableReviewAndAudit',
 'realPg17NativeBackupRestoreAndRls','realPg17SeparateProcessReplayDenied',
 'syntheticGitHubReviewHistoryAndNoSelfReview',
 'syntheticS3ReplicationAndFullEncryptedBytes',
 'actualGitHubReviewersVerified','actualAwsReplicaVerified',
 'productionAuthorized'
].sort().join(',');
const mustHold=Object.freeze([
 'REAL_GITHUB_ENVIRONMENT_APPROVAL_EVENTS',
 'TWO_IDENTIFIED_HUMAN_REVIEWERS',
 'LIVE_AWS_STS_AND_EFFECTIVE_IAM',
 'LIVE_S3_CROSS_ACCOUNT_REPLICATION',
 'REAL_STAGING_RPO_RTO_AND_PRIVACY'
]);
export const R180_EXTERNAL_BLOCKERS=mustHold;
export function classifyR180Evidence(report,{commit,bundleSha256,
 clock=()=>Date.now()}={}){
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  keys(report)===reportKeys&&report.schemaVersion===1&&
  H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  report.commit===commit&&report.sourceBundleSha256===bundleSha256&&
  H64.test(report.historyRootSha256||'')&&
  H64.test(report.reviewEvidenceSha256||'')&&
  /^\d{12}$/.test(report.sourceAccountId||'')&&
  /^\d{12}$/.test(report.offsiteAccountId||'')&&
  report.sourceAccountId!==report.offsiteAccountId&&
  report.productionAuthorized===false&&
  report.actualGitHubReviewersVerified===false&&
  report.actualAwsReplicaVerified===false,
  'R179 exact synthetic-only, source-bound report required');
 for(const field of [
  'realPg17ImmutableReviewAndAudit',
  'realPg17NativeBackupRestoreAndRls',
  'realPg17SeparateProcessReplayDenied',
  'syntheticGitHubReviewHistoryAndNoSelfReview',
  'syntheticS3ReplicationAndFullEncryptedBytes'
 ])ok(report[field]===true,'R179 prior native or synthetic evidence missing: '+field);
 const p=report.reviewProof;
 ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
  p.schemaVersion===1&&p.scope==='isolated-staging-review-simulation'&&
  p.decision==='CI_SIMULATED_REVIEW_ONLY'&&
  p.commit===commit&&p.bundleSha256===bundleSha256&&
  p.historyRootSha256===report.historyRootSha256&&
  p.sourceAccountId===report.sourceAccountId&&
  p.offsiteAccountId===report.offsiteAccountId&&
  Number.isSafeInteger(p.sequence)&&p.sequence>=2&&p.sequence<=32&&
  Number.isSafeInteger(p.runId)&&p.runId>=10000&&
  Number.isSafeInteger(p.actorId)&&p.actorId>0&&
  /^[a-f0-9]{32}$/.test(p.nonce||'')&&
  ['archiveSha256','restoredStateSha256','probeSha256',
   'r178EvidenceSha256','githubEvidenceSha256',
   'replicationEvidenceSha256','evidenceSha256']
   .every(k=>H64.test(p[k]||''))&&
  p.githubReviewEventsShapeValid===true&&
  p.replicationStatusShapeValid===true&&
  p.actualHumanApprovalsVerified===false&&
  p.realAwsDeliveryVerified===false&&
  p.actualGitHubProviderIndependentlyVerified===false&&
  p.productionAuthorized===false,
  'R179 simulated approval/provenance report is incomplete or elevated');
 const {evidenceSha256,...body}=p;
 ok(eq(evidenceSha256,rawSha(body))&&
  eq(evidenceSha256,report.reviewEvidenceSha256),
  'R179 signed-source SHA differs from exact report bytes');
 const now=clock();
 ok(Number.isSafeInteger(now)&&now>0,'positive, precise evidence timestamp');
 const data={
  schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
  historyRootSha256:p.historyRootSha256,
  reviewEvidenceSha256:p.evidenceSha256,
  restoredStateSha256:p.restoredStateSha256,
  archiveSha256:p.archiveSha256,
  sequence:p.sequence,nonce:p.nonce,runId:p.runId,actorId:p.actorId,
  sourceAccountId:p.sourceAccountId,offsiteAccountId:p.offsiteAccountId,
  scope:'isolated-native-pg17-with-synthetic-provider-responses',
  decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING',
  blockers:[...mustHold],
  nativePg17BackupAndRlsChecked:true,
  realAwsSessionsVerified:false,
  realCloudReplicationVerified:false,
  realGitHubApprovalsVerified:false,
  realHumanIdentityVerified:false,
  productionRpoRtoVerified:false,
  productionAuthorized:false,
  classifiedAtMs:now
 };
 return Object.freeze({...data,blockers:Object.freeze(data.blockers),
  evidenceSha256:sha(data)});
}
export function verifyR180Classification(result,{commit,bundleSha256,
 clock=()=>Date.now(),maxAgeMs=1800000}={}){
 ok(result&&Object.getPrototypeOf(result)===Object.prototype&&
  H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  Number.isSafeInteger(maxAgeMs)&&maxAgeMs>=1000&&maxAgeMs<=3600000,
  'pin source SHA and bounded review duration');
 const {evidenceSha256,blockers,...base}=result;
 ok(keys(base)===keys({
  schemaVersion:0,sourceCommit:'',sourceBundleSha256:'',
  historyRootSha256:'',reviewEvidenceSha256:'',restoredStateSha256:'',
  archiveSha256:'',sequence:0,nonce:'',runId:0,actorId:0,
  sourceAccountId:'',offsiteAccountId:'',scope:'',decision:'',
  nativePg17BackupAndRlsChecked:false,realAwsSessionsVerified:false,
  realCloudReplicationVerified:false,realGitHubApprovalsVerified:false,
  realHumanIdentityVerified:false,productionRpoRtoVerified:false,
  productionAuthorized:false,classifiedAtMs:0
 })&&
  result.schemaVersion===1&&result.sourceCommit===commit&&
  result.sourceBundleSha256===bundleSha256&&
  result.scope==='isolated-native-pg17-with-synthetic-provider-responses'&&
  result.decision==='NO_GO_EXTERNAL_EVIDENCE_PENDING'&&
  Array.isArray(blockers)&&
  JSON.stringify(blockers)===JSON.stringify(mustHold)&&
  result.nativePg17BackupAndRlsChecked===true&&
  ['realAwsSessionsVerified','realCloudReplicationVerified',
   'realGitHubApprovalsVerified','realHumanIdentityVerified',
   'productionRpoRtoVerified','productionAuthorized']
   .every(k=>result[k]===false)&&
  Number.isSafeInteger(result.classifiedAtMs)&&
  clock()>=result.classifiedAtMs&&
  clock()-result.classifiedAtMs<=maxAgeMs&&
  H64.test(evidenceSha256||'')&&
  eq(evidenceSha256,sha({...base,blockers:[...blockers]})),
  'NO-GO classification changed, expired, or falsely elevated');
 return Object.freeze({verified:true,noGo:true,
  evidenceSha256,productionAuthorized:false});
}
