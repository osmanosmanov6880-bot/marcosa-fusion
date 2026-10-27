/** R140 - current-main, real-STAGING-parent, read-only root-canary PLAN trust gate. */
export const R140_REPO='osmanosmanov6880-bot/marcosa-fusion';
export const R140_STAGING_NAME='MARCOSA | Build, test and deploy STAGING';
export const R140_NGINX_SHA='24d71ff2c19d6f2f5a976f1e08e942875a16e3be0e5a86cf5d22c35b0acc956a';
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const fail=(condition,why)=>{if(!condition)throw Error(why);};

export function verifyR140Trigger({eventName,repository,ref,sourceSha,confirmation,payload}={}){
  fail(repository===R140_REPO&&ref==='refs/heads/main'&&SHA40.test(sourceSha||''),
    'R140 accepts only exact approved main source');
  if(eventName==='workflow_dispatch'){
    fail(confirmation==='AUDIT-MARCOSA-CANARY-READONLY',
      'R140 manual read-only review requires explicit confirmation');
    return 'explicit_manual_main';
  }
  fail(eventName==='workflow_run','R140 refused untrusted GitHub event');
  const run=payload?.workflow_run;
  fail(payload?.action==='completed'&&run&&run.name===R140_STAGING_NAME&&
    run.event==='push'&&run.head_branch==='main'&&
    run.head_repository?.full_name===R140_REPO&&
    run.head_sha===sourceSha&&run.status==='completed'&&
    run.conclusion==='success'&&Number.isSafeInteger(run.id)&&run.id>0,
    'R140 refused stale, failed, foreign or non-STAGING predecessor');
  return 'trusted_staging_completed';
}

export function verifyR140Plan({plan,sourceSha,currentMainSha}={}){
  fail(SHA40.test(sourceSha||'')&&sourceSha===currentMainSha,
    'R140 current GitHub main differs from approved plan source');
  fail(plan&&typeof plan==='object'&&!Array.isArray(plan)&&
    plan.sourceSha===sourceSha&&
    plan.beforeConfigSha256===R140_NGINX_SHA&&
    SHA64.test(plan.afterConfigSha256||'')&&
    SHA64.test(plan.liveRootSha256||'')&&
    plan.canaryPath==='/network-os/'&&
    plan.rootReplacementAllowed===false&&
    Number.isSafeInteger(plan.stagingAssetsVerified)&&
    plan.stagingAssetsVerified>=3&&plan.stagingAssetsVerified<=5000,
    'R140 actual VPS canary plan is stale, incomplete or untrusted');
  fail(plan.productionCutoverAuthorized!==true&&plan.productionAuthorized!==true,
    'R140 plan cannot authorize production');
  return Object.freeze({
    sourceSha,stagingAssetsVerified:plan.stagingAssetsVerified,
    status:'CURRENT_MAIN_STAGING_READONLY_PLAN_PASS',
    productionDecision:'NO_GO',
  });
}
