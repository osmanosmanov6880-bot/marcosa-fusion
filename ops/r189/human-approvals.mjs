import {H40,H64,plain,requireTrue,seal} from './evidence.mjs';
export function assessHumanApprovals({commit,bundleSha256,reviewers=[],externalRegistryVerified=false,sourceMode='CI_SYNTHETIC'}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
 sourceMode==='CI_SYNTHETIC'&&Array.isArray(reviewers)&&reviewers.length<=10,
 'only isolated bounded reviewer assertions allowed');
 const identities=new Set(),roles=new Set();
 for(const r of reviewers){
  requireTrue(plain(r)&&Object.keys(r).sort().join(',')==='approval,personId,role,verifiedByIndependentAuthority'&&
  typeof r.personId==='string'&&/^[a-z0-9_-]{4,64}$/.test(r.personId)&&
  ['SECURITY','OPERATIONS','PRIVACY'].includes(r.role)&&
  typeof r.approval==='boolean'&&typeof r.verifiedByIndependentAuthority==='boolean',
  'untrusted human review record');
  requireTrue(!identities.has(r.personId)&&!roles.has(r.role),'duplicate reviewer identity or role');
  identities.add(r.personId);roles.add(r.role);
 }
 const approved=externalRegistryVerified===true&&
  ['SECURITY','OPERATIONS','PRIVACY'].every(role=>reviewers.some(r=>
   r.role===role&&r.approval===true&&r.verifiedByIndependentAuthority===true));
 return seal({schemaVersion:1,kind:'R189_HUMAN',sourceCommit:commit,
  sourceBundleSha256:bundleSha256,sourceMode,
  reviewRecords:reviewers.length,independentExternalRegistryClaim:externalRegistryVerified===true,
  reviewerQuorumClaim:approved,actualIdentitiesVerifiedByThisModule:false,
  decision:'NO_GO_REAL_HUMAN_APPROVAL_REQUIRES_EXTERNAL_VERIFICATION',
  realPilotAuthorized:false,productionAuthorized:false});
}
