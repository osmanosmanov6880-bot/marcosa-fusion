/** R192 final cross-evidence no-GO verdict with actionable blocker list.
 * Policy intentionally has no GO branch. */
import {H40,H64,requireTrue,verifyReceipt,sealReceipt} from '../r190/common.mjs';
export const R192_NO_GO='NO_GO_EXTERNAL_APPROVALS_AND_LIVE_STAGING_REQUIRED';
const humanActions={
 HEAD_COMMIT_SIGNATURE_MISSING:'Obtain a trusted signed commit at exact SHA',
 UNRESOLVED_CHANGES_REQUESTED:'Resolve each outstanding GitHub review',
 MISSING_SECURITY_REVIEW:'Request independent Security PR approval',
 MISSING_OPERATIONS_REVIEW:'Request independent Operations PR approval',
 MISSING_PRIVACY_REVIEW:'Request independent Privacy PR approval',
 REVIEW_HISTORY_NOT_ACCEPTED:'Verify full chronological GitHub review history',
 NATURAL_PERSON_IDENTITIES_NOT_INDEPENDENTLY_ATTESTED:'Validate reviewer identities outside CI',
 AWS_SCP_KMS_RESOURCE_POLICY_NOT_EXTERNALLY_ATTESTED:'Conduct independent AWS SCP, KMS and bucket-policy readback',
 SOURCE_DESTRUCTIVE_IAM_ACTION_NOT_DENIED:'Remove source account IAM destructive allow',
 OFFSITE_DESTRUCTIVE_IAM_ACTION_NOT_DENIED:'Remove offsite account IAM destructive allow',
 TRUST_KEY_ROTATION_NOT_INDEPENDENTLY_ACCEPTED:'Verify new key ownership and old quorum out of band',
 LIVE_STAGING_TLS_CERTIFICATE_NOT_ATTESTED:'Inspect actual staging cert chain and independent pin',
 LIVE_STAGING_RECOVERY_NOT_MEASURED:'Measure staging recovery and verify restored content',
 LEGAL_PRIVACY_APPROVAL_MISSING:'Obtain human legal/privacy compliance approval'
};
export function assessR192Release({commit,bundleSha256,
 parentR191Commit,review,rotation,iamRisk,clock=()=>Date.now()}={}){
 requireTrue(H40.test(commit||'')&&H40.test(parentR191Commit||'')&&
  H64.test(bundleSha256||'')&&typeof clock==='function',
  'exact R192 and R191 ancestry required');
 const a=verifyReceipt(review,'R192_REVIEW',commit,bundleSha256);
 const b=verifyReceipt(rotation,'R192_ROTATION',commit,bundleSha256);
 const c=verifyReceipt(iamRisk,'R192_IAM_RISK',commit,bundleSha256);
 const t=clock();
 for(const r of [a,b,c]){
  requireTrue(Number.isSafeInteger(r.observedAtMs)&&r.observedAtMs<=t&&
   (r.expiresAtMs===undefined||t<=r.expiresAtMs),
   'evidence readback stale or from future');
 }
 requireTrue(H64.test(a.githubEvidenceSha256||'')&&
  typeof a.githubQuorumClaim==='boolean',
  'reviewer claim must be explicit and source-bound');
 requireTrue(b.verifiedOldSignerCount===3&&b.actualRotations===1&&
  b.priorGeneration+1===b.newGeneration&&
  b.outsideHumanIdentityVerification===false,
  'invalid trust key lifecycle proof');
 requireTrue(c.simulatedActions===24&&c.awsEffectiveRightsIndependentlyVerified===false,
  'AWS simulation must not claim live authorization');
 const blockers=[...new Set([
  ...a.blockers,...c.blockers,
  'TRUST_KEY_ROTATION_NOT_INDEPENDENTLY_ACCEPTED',
  'LIVE_STAGING_TLS_CERTIFICATE_NOT_ATTESTED',
  'LIVE_STAGING_RECOVERY_NOT_MEASURED',
  'LEGAL_PRIVACY_APPROVAL_MISSING'
 ])].sort();
 requireTrue(blockers.every(x=>Object.hasOwn(humanActions,x)),
  'unknown blocker: update remediation registry before release');
 return sealReceipt({schemaVersion:1,kind:'R192_RELEASE',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  parentR191Commit,reviewEvidenceSha256:a.evidenceSha256,
  rotationEvidenceSha256:b.evidenceSha256,
  iamRiskEvidenceSha256:c.evidenceSha256,
  blockers,remediation:blockers.map(code=>({code,action:humanActions[code]})),
  operatorHandoffRequired:true,liveInfrastructureApproved:false,
  observedAtMs:t,decision:R192_NO_GO,
  realPilotAuthorized:false,productionAuthorized:false});
}
