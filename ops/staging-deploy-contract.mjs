/**
 * R83: audited, human-requested STAGING deployment contract.
 *
 * This check cannot establish provider console identity or authorize real
 * production. It rejects auto-push/PR publishing before SSH credentials are
 * touched. Only the isolated static STAGING site is in scope.
 */
export const STAGING_REPO='osmanosmanov6880-bot/marcosa-fusion';
export const STAGING_APPROVAL='DEPLOY-MARCOSA-STAGING';
const SHA=/^[0-9a-f]{40}$/;
const demand=(condition,message)=>{if(!condition)throw Error(message);};

export function validateStagingDispatch({
 repository,eventName,ref,sha,confirmation,environment='marcosa-staging'
}={}){
 demand(repository===STAGING_REPO,'Unexpected release repository');
 demand(eventName==='workflow_dispatch','Automatic, scheduled, PR and push-based SSH deployment forbidden');
 demand(ref==='refs/heads/main','STAGING deployment restricted to reviewed main');
 demand(typeof sha==='string'&&SHA.test(sha),'Full exact Git source SHA required');
 demand(confirmation===STAGING_APPROVAL,'Explicit human STAGING confirmation required');
 demand(environment==='marcosa-staging','Wrong release environment');
 return {sourceTrustedForStaging:true,requestedCommit:sha,
  destination:'isolated static STAGING only',networkContacted:false,
  productionAuthorized:false,providerHostProvenanceVerified:false,
  requiresIndependentEnvironmentReviewer:true};
}
