/** Strict public, source-bound intake of offline operator claims.
 * Contains only hashes and enums; no free-text personal data or secrets.
 * An operator claim is never automatic evidence of external authorization.
 */
import {H40,H64,plain,requireTrue,sealReceipt} from '../r190/common.mjs';
export const R193_CONTROLS=Object.freeze([
 'TLS_ORIGIN','AWS_EFFECTIVE_RIGHTS','STAGING_RESTORE',
 'PRIVACY_LEGAL','HUMAN_IDENTITY','GITHUB_ENVIRONMENT'
]);
const authority=['CI_FIXTURE','OPERATOR_OBSERVED_UNVERIFIED'];
const claim=['PASS_CLAIM','FAIL_CLAIM','UNAVAILABLE'];
export function ingestR193Evidence({
 commit,bundleSha256,records=[],sourceMode='CI_FIXTURE',
 clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  Array.isArray(records)&&records.length<=R193_CONTROLS.length&&
  authority.includes(sourceMode)&&typeof clock==='function',
  'only bounded untrusted operator claim source permitted');
 const now=clock();
 requireTrue(Number.isSafeInteger(now)&&now>0,'valid intake timestamp required');
 const seen=new Set(),validated=[];
 for(const r of records){
  requireTrue(plain(r)&&Object.keys(r).sort().join(',')===
   'artifactSha256,authority,claim,control,expiresAtMs,observedAtMs,sourceCommit'&&
   R193_CONTROLS.includes(r.control)&&!seen.has(r.control)&&
   r.sourceCommit===commit&&H64.test(r.artifactSha256||'')&&
   authority.includes(r.authority)&&r.authority===sourceMode&&
   claim.includes(r.claim)&&Number.isSafeInteger(r.observedAtMs)&&
   Number.isSafeInteger(r.expiresAtMs)&&
   r.observedAtMs<=now&&now<=r.expiresAtMs&&
   r.expiresAtMs>r.observedAtMs&&
   r.expiresAtMs-r.observedAtMs<=86400000,
   'malformed, duplicated, stale or foreign source evidence');
  seen.add(r.control);
  validated.push({control:r.control,artifactSha256:r.artifactSha256,
   authority:r.authority,claim:r.claim,
   sourceCommit:commit,observedAtMs:r.observedAtMs,
   expiresAtMs:r.expiresAtMs});
 }
 validated.sort((a,b)=>R193_CONTROLS.indexOf(a.control)-
  R193_CONTROLS.indexOf(b.control));
 return sealReceipt({schemaVersion:1,kind:'R193_INTAKE',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,sourceMode,
  records:validated,acceptedRecordCount:validated.length,
  externalArtifactBytesVerified:false,
  operatorIdentityIndependentlyVerified:false,
  allClaimsUnverified:true,
  observedAtMs:now,expiresAtMs:now+60000,
  decision:'NO_GO_EXTERNAL_ATTESTATION_NOT_VERIFIED',
  realPilotAuthorized:false,productionAuthorized:false});
}
