/** Cross-bind live-lookups and pinned signatures; never issue production clearance. */
import {H40,H64,requireTrue,sealReceipt,verifyReceipt} from './common.mjs';
export function assessR190({sourceCommit,bundleSha256,r189Commit,
 github,signers,tls,nativePg17Witness=false}={}){
 requireTrue(H40.test(sourceCommit||'')&&H40.test(r189Commit||'')&&
  H64.test(bundleSha256||''),'exact source and previous release required');
 const g=verifyReceipt(github,'R190_GITHUB',sourceCommit,bundleSha256);
 const s=verifyReceipt(signers,'R190_SIGNERS',sourceCommit,bundleSha256);
 const t=verifyReceipt(tls,'R190_TLS',sourceCommit,bundleSha256);
 requireTrue(s.cryptographicSignaturesVerified===3&&
  Array.isArray(s.verifiedSigners)&&s.verifiedSigners.length===3&&
  s.githubEvidenceSha256===g.evidenceSha256&&
  s.tlsEvidenceSha256===t.evidenceSha256&&
  g.repo==='osmanosmanov6880-bot/marcosa-fusion'&&g.pullRequest===168&&
  t.externalTlsIdentityIndependentlyVerified===false&&
  g.identitiesIndependentlyEstablished===false&&
  s.externallyVerifiedHumanIdentities===false,
  'independent proof source or NO-GO ancestry mismatch');
 const blockers=[
  ...(!g.allCurrentHeadReviewClaimsSatisfied?
   ['CURRENT_HEAD_THREE_GITHUB_REVIEWS_NOT_CONFIRMED']:[]),
  ...(!t.allReadOnlyHealthChecksPassed?
   ['STAGING_HTTPS_READONLY_HEALTH_NOT_CONFIRMED']:[]),
  ...(!nativePg17Witness?['NATIVE_PG17_WITNESS_NOT_SUPPLIED']:[]),
  'HUMAN_IDENTITIES_NOT_INDEPENDENTLY_VERIFIED',
  'GITHUB_ENVIRONMENT_EFFECTIVE_RIGHTS_NOT_PROVEN',
  'AWS_EFFECTIVE_RIGHTS_NOT_PROVEN',
  'TLS_ORIGIN_NOT_INDEPENDENTLY_ATTESTED',
  'LIVE_STAGING_RESTORE_AND_PRIVACY_SIGNOFF_PENDING'
 ];
 return sealReceipt({schemaVersion:1,kind:'R190_FINAL',
  sourceCommit,sourceBundleSha256:bundleSha256,r189Commit,
  githubEvidenceSha256:g.evidenceSha256,
  signaturesEvidenceSha256:s.evidenceSha256,
  tlsEvidenceSha256:t.evidenceSha256,
  nativePg17WitnessClaim:nativePg17Witness===true,blockers,
  decision:'NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
