/**
 * R91: owner-requested automated SSH STAGING deploy on trusted main push.
 * Manual dispatch still requires explicit confirmation.
 * Neither mode bypasses protected staging environment, strict SSH host pin,
 * reviewed source commit, isolated marcosa-deploy user or public HTTPS proof.
 * The validator cannot attest ownership of the external VPS by itself.
 */
export const STAGING_REPO='osmanosmanov6880-bot/marcosa-fusion';
export const STAGING_APPROVAL='DEPLOY-MARCOSA-STAGING';
const SHA=/^[0-9a-f]{40}$/;
const demand=(condition,message)=>{if(!condition)throw Error(message);};

export function validateStagingDispatch({
 repository,eventName,ref,sha,confirmation,environment='marcosa-staging'
}={}){
 demand(repository===STAGING_REPO,'Unexpected release repository');
 demand(eventName==='push'||eventName==='workflow_dispatch',
  'Only trusted main push or explicit manual STAGING dispatch is permitted');
 demand(ref==='refs/heads/main','STAGING deployment restricted to reviewed main');
 demand(typeof sha==='string'&&SHA.test(sha),'Full exact Git source SHA required');
 demand(environment==='marcosa-staging','Wrong release environment');
 if(eventName==='workflow_dispatch')
  demand(confirmation===STAGING_APPROVAL,'Explicit human STAGING confirmation required');
 else
  demand(confirmation==null||confirmation==='','Automatic main push must not carry manual override');
 return {sourceTrustedForStaging:true,requestedCommit:sha,
  trigger:eventName==='push'?'trusted-main-push':'confirmed-main-manual-dispatch',
  destination:'isolated static STAGING only',networkContacted:false,
  productionAuthorized:false,providerHostProvenanceVerified:false,
  requiresIndependentEnvironmentReviewer:true,
  requiresPinnedHostAndIndependentHttpsReadback:true};
}
