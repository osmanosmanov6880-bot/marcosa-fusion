/**
 * R192 PR reviewer quorum classifier: source-pinned and expiry-bounded
 * R191 GitHub receipt. No "deploy approved" branch, ever.
 */
import {H40,H64,plain,requireTrue,verifyReceipt,sealReceipt} from '../r190/common.mjs';
const roles=['SECURITY','OPERATIONS','PRIVACY'];
export function assessR192ReviewDecision({commit,bundleSha256,github,clock=()=>Date.now()}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof clock==='function','exact source commit and clock required');
 const h=verifyReceipt(github,'R191_PR',commit,bundleSha256);
 const t=clock();
 requireTrue(Number.isSafeInteger(t)&&Number.isSafeInteger(h.observedAtMs)&&
  Number.isSafeInteger(h.expiresAtMs)&&t>=h.observedAtMs&&t<=h.expiresAtMs,
  'GitHub source receipt expired');
 requireTrue(h.repository==='osmanosmanov6880-bot/marcosa-fusion'&&
  h.pullRequest===168&&h.reviewPagesComplete===true&&
  Array.isArray(h.reviewChecks)&&h.reviewChecks.length===3&&
  h.reviewChecks.every((r,i)=>plain(r)&&r.role===roles[i]&&
   Number.isSafeInteger(r.githubUserId)&&r.githubUserId>0&&
   typeof r.approved==='boolean')&&
  new Set(h.reviewChecks.map(r=>r.githubUserId)).size===3,
  'three source-pinned independent reviewer identities must be represented');
 const approvals=h.reviewChecks.filter(r=>r.approved).length;
 const blockers=[];
 if(h.commitSignatureVerifiedByGithub!==true)
  blockers.push('HEAD_COMMIT_SIGNATURE_MISSING');
 if(h.unresolvedChangesOnHead!==0)
  blockers.push('UNRESOLVED_CHANGES_REQUESTED');
 for(const r of h.reviewChecks)if(!r.approved)
  blockers.push('MISSING_'+r.role+'_REVIEW');
 if(h.allRequiredReviewEventsObserved!==true)
  blockers.push('REVIEW_HISTORY_NOT_ACCEPTED');
 blockers.push('NATURAL_PERSON_IDENTITIES_NOT_INDEPENDENTLY_ATTESTED');
 const safe=sealReceipt({schemaVersion:1,kind:'R192_REVIEW',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  githubEvidenceSha256:h.evidenceSha256,
  sourceMode:h.sourceMode,
  reviewerCount:approvals,
  signedCommitClaim:h.commitSignatureVerifiedByGithub===true,
  githubQuorumClaim:approvals===3&&h.unresolvedChangesOnHead===0,
  blockers,
  expiresAtMs:h.expiresAtMs,observedAtMs:t,
  decision:'NO_GO_HUMAN_REVIEW_EXTERNAL_VERIFICATION_REQUIRED',
  realPilotAuthorized:false,productionAuthorized:false});
 return safe;
}
