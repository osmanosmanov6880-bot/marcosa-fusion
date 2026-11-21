import {H40,H64,requireTrue,receipt,seal} from './evidence.mjs';
export function assessR189({commit,bundleSha256,r188Commit,previousHead,ciR188Success=false,
 human,infrastructure,recovery}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
 H40.test(r188Commit||'')&&H40.test(previousHead||''),
 'source, ancestry and exact CI references mandatory');
 const proofs=[
  receipt(human,'R189_HUMAN',commit,bundleSha256),
  receipt(infrastructure,'R189_INFRA',commit,bundleSha256),
  receipt(recovery,'R189_RECOVERY',commit,bundleSha256)
 ];
 requireTrue(proofs.every(x=>x.productionAuthorized===false&&x.realPilotAuthorized===false),
 'positive authorization forbidden');
 const blockers=[
  ...(!ciR188Success?['R188_CI_NOT_VERIFIED']:[]),
  'REAL_HUMAN_IDENTITIES_NOT_VERIFIED',
  'LIVE_PROVIDER_EFFECTIVE_RIGHTS_NOT_VERIFIED',
  'REAL_STAGING_RECOVERY_NOT_VERIFIED',
  'REAL_PRIVACY_LEGAL_APPROVAL_MISSING'
 ];
 return seal({schemaVersion:1,kind:'R189_FINAL',sourceCommit:commit,
  sourceBundleSha256:bundleSha256,r188Commit,previousHead,
  r188CiSuccessClaim:ciR188Success===true,
  proofHashes:proofs.map(p=>p.evidenceSha256),blockers,
  decision:'NO_GO_INDEPENDENT_STAGING_ACCEPTANCE_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
