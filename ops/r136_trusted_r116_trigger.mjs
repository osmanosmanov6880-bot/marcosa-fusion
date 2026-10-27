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

/**
 * R137: after a legitimate R116 completion, Pages HTTPS byte readback can
 * still be running. Never run R133 until ALL its independent workflows are
 * completed on the same CURRENT main SHA. This is a readiness barrier only:
 * the R133 strict job/artifact verifier remains authoritative.
 */
export async function awaitR133Inputs({sourceSha,stages,listRuns,getCurrentMain,pause,attempts=24}={}){
  fail(SHA.test(sourceSha||''),'R137 exact SHA required');
  fail(stages&&typeof stages==='object'&&!Array.isArray(stages)&&
    ['r48','pages','staging','r114','r116'].every(k=>Object.hasOwn(stages,k))&&
    Object.keys(stages).length===5,'R137 exactly five trusted stages required');
  fail(typeof listRuns==='function'&&typeof getCurrentMain==='function'&&
    typeof pause==='function'&&Number.isInteger(attempts)&&
    attempts>=1&&attempts<=24,'R137 bounded read-only polling required');
  for(let attempt=0;attempt<attempts;attempt++){
    fail(await getCurrentMain()===sourceSha,
      'R137 main changed before verification; stale SHA refused');
    const pending=[];
    for(const key of ['r48','pages','staging','r114','r116']){
      const stage=stages[key];
      fail(stage&&/^[a-z0-9-]+\.yml$/.test(stage.file)&&
        typeof stage.name==='string'&&stage.name.startsWith('MARCOSA | ' )&&
        ['push','workflow_run'].includes(stage.event),
        'R137 untrusted workflow definition');
      const path='/actions/workflows/'+stage.file+
        '/runs?branch=main&head_sha='+sourceSha+'&per_page=100';
      const listing=await listRuns(path);
      fail(listing&&Array.isArray(listing.workflow_runs)&&
        Number.isSafeInteger(listing.total_count)&&
        listing.total_count>=0&&listing.total_count<=100&&
        listing.total_count===listing.workflow_runs.length,
        'R137 incomplete or paginated GitHub run listing: '+key);
      const matching=listing.workflow_runs.filter(r=>r&&
        Number.isSafeInteger(r.id)&&r.id>0&&
        r.name===stage.name&&r.event===stage.event&&
        r.head_sha===sourceSha&&r.head_branch==='main'&&
        r.head_repository?.full_name===R136_REPO)
        .sort((a,b)=>b.id-a.id);
      const latest=matching[0];
      if(!latest||latest.status!=='completed'){
        pending.push(key);
      }else{
        fail(latest.conclusion==='success',
          'R137 required '+key+' most recent exact-SHA workflow failed: '+
          String(latest.conclusion||'unknown'));
      }
    }
    fail(await getCurrentMain()===sourceSha,
      'R137 main advanced during verification; stale SHA refused');
    if(!pending.length)return Object.freeze({
      sourceSha,stagesReady:5,attempt:attempt+1,
      status:'READY_FOR_R133_STRICT_JOB_ARTIFACT_VERIFICATION',
      productionDecision:'NO_GO',
    });
    if(attempt<attempts-1)await pause(15000);
  }
  throw Error('R137 timed out waiting for all five current SHA stages');
}
