/**
 * R136 - accept only a trusted, completed R116 on the CURRENT main SHA.
 * R133 remains a read-only evidence validator. This module never invokes
 * production, SSH or user services, and accepts no untrusted source checkout.
 */
export const R136_R116_NAME =
  'MARCOSA | R116 read-only live VPS rollback readiness after each STAGING release';
export const R136_R114_NAME =
  'MARCOSA | R114 dual-channel SAME-SHA release evidence';
export const R136_REPO='osmanosmanov6880-bot/marcosa-fusion';
export const R136_R114_FILE='marcosa-r114-release-evidence.yml';
const SHA=/^[a-f0-9]{40}$/;
const fail=(yes,msg)=>{if(!yes)throw Error(msg)};

export function verifyR136Trigger({eventName,repository,ref,sourceSha,payload}={}){
  fail(repository===R136_REPO&&ref==='refs/heads/main'&&SHA.test(sourceSha||''),
    'R136 requires valid current main repository, ref and SHA');
  if(eventName==='workflow_dispatch')return 'manual';
  fail(eventName==='workflow_run','R136 refuses untrusted event types');
  const run=payload?.workflow_run;
  fail(payload?.action==='completed'&&run&&
    run.name===R136_R116_NAME&&
    run.event==='workflow_run'&&
    run.head_branch==='main'&&
    run.head_repository?.full_name===R136_REPO&&
    run.head_sha===sourceSha&&
    run.status==='completed'&&run.conclusion==='success'&&
    Number.isSafeInteger(run.id)&&run.id>0,
    'R136 refuses failed, foreign, stale, PR, or non-R116 trigger');
  return 'trusted_r116_completed';
}

/**
 * R116 and R114 both follow upstream STAGING/Pages, but finish in
 * nondeterministic order. Poll ONLY the exact source-SHA R114 run listing.
 * A pending/missing R114 never counts as PASS, and the strict R133 gate
 * subsequently downloads and verifies actual current-run JSON evidence.
 */
export async function awaitR114({sourceSha,listRuns,pause,attempts=16}={}){
  fail(SHA.test(sourceSha||''),'Exact main SHA required');
  fail(typeof listRuns==='function'&&typeof pause==='function'&&
    Number.isInteger(attempts)&&attempts>=1&&attempts<=20,
    'R136 bounded read-only polling required');
  const path='/actions/workflows/'+R136_R114_FILE+
    '/runs?branch=main&head_sha='+sourceSha+'&per_page=100';
  for(let attempt=0;attempt<attempts;attempt++){
    const listing=await listRuns(path);
    fail(listing&&Number.isSafeInteger(listing.total_count)&&
      listing.total_count>=0&&listing.total_count<=100&&
      Array.isArray(listing.workflow_runs)&&
      listing.total_count===listing.workflow_runs.length,
      'R136 refuses incomplete or oversized GitHub workflow listings');
    const runs=listing.workflow_runs.filter(r=>r&&
      r.name===R136_R114_NAME&&
      r.event==='workflow_run'&&r.head_branch==='main'&&
      r.head_repository?.full_name===R136_REPO&&
      r.head_sha===sourceSha&&Number.isSafeInteger(r.id)&&r.id>0)
      .sort((a,b)=>b.id-a.id);
    const latest=runs[0];
    if(latest?.status==='completed'&&latest.conclusion==='success')
      return Object.freeze({runId:latest.id,attempt:attempt+1});
    if(attempt<attempts-1)await pause(15000);
  }
  throw Error('R136 exact-main R114 did not complete successfully within bounded retries');
}
