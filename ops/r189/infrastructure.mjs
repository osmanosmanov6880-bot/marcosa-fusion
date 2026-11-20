import {H40,H64,plain,requireTrue,seal} from './evidence.mjs';
const REQUIRED=['githubEnvironment','tlsCertificate','awsPermissions'];
export function assessInfrastructure({commit,bundleSha256,observations={}}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&plain(observations),
 'source-bound infrastructure evidence required');
 for(const key of Object.keys(observations))
  requireTrue(REQUIRED.includes(key),'unexpected provider evidence: '+key);
 const checks=REQUIRED.map(key=>{
  const x=observations[key];
  if(x===undefined)return {name:key,present:false,verified:false};
  requireTrue(plain(x)&&Object.keys(x).sort().join(',')==='independentObserver,observedSourceCommit,verified'&&
   typeof x.verified==='boolean'&&typeof x.independentObserver==='boolean'&&
   x.observedSourceCommit===commit,'provider observation not source pinned');
  return {name:key,present:true,verified:x.verified&&x.independentObserver};
 });
 return seal({schemaVersion:1,kind:'R189_INFRA',sourceCommit:commit,
  sourceBundleSha256:bundleSha256,checks,allIndependentClaims:checks.every(x=>x.verified),
  realProviderPermissionsMeasuredByThisModule:false,
  decision:'NO_GO_EXTERNAL_PROVIDER_ATTESTATION_REQUIRED',
  realPilotAuthorized:false,productionAuthorized:false});
}
