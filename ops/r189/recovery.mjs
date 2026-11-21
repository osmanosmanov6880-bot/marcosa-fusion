import {H40,H64,plain,requireTrue,seal} from './evidence.mjs';
export function assessRecovery({commit,bundleSha256,primary,restored,backupSha256,
 externalWitness=false}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
 H64.test(backupSha256||'')&&plain(primary)&&plain(restored),
 'bounded source-bound restoration proof required');
 const keys=['recordCount','recordsSha256','forceRls','quarantineClosed'];
 for(const v of [primary,restored]){
  requireTrue(Object.keys(v).sort().join(',')===keys.slice().sort().join(',')&&
   Number.isSafeInteger(v.recordCount)&&v.recordCount>=0&&v.recordCount<=1000000&&
   H64.test(v.recordsSha256||'')&&typeof v.forceRls==='boolean'&&
   typeof v.quarantineClosed==='boolean','invalid recovery record shape');
 }
 const exact=keys.every(k=>primary[k]===restored[k])&&
  primary.forceRls===true&&primary.quarantineClosed===true;
 return seal({schemaVersion:1,kind:'R189_RECOVERY',sourceCommit:commit,
  sourceBundleSha256:bundleSha256,backupSha256,exactReadback:exact,
  externalWitnessClaim:externalWitness===true,
  actualExternalRestoreVerifiedByThisModule:false,
  decision:'NO_GO_REAL_STAGING_RESTORE_REQUIRES_EXTERNAL_WITNESS',
  realPilotAuthorized:false,productionAuthorized:false});
}
