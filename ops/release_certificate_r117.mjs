#!/usr/bin/env node
/**
 * MARCOSA R117: machine-readable, fail-closed PREVIEW release certificate.
 *
 * A PASS needs the same reviewed git SHA in GitHub Pages HTTPS readback,
 * verified Contabo SSH staging deployment, and R116's REAL read-only VPS
 * rollback-candidate verification. No SSH, production, database, or writes.
 */
import {writeFileSync, appendFileSync, readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateRelease, REPO, PIPELINES} from './release_evidence_r114.mjs';

export const R116 = Object.freeze({
  name: 'MARCOSA | R116 read-only live VPS rollback readiness after each STAGING release',
  file: 'marcosa-r116-rollback-readiness.yml',
  requiredJobs: Object.freeze(['offline-rehearsal', 'read-only-vps-proof']),
});
const SHA40 = /^[0-9a-f]{40}$/;
const API = 'https://api.github.com/repos/' + REPO + '/';
const demand = (condition, reason) => {if (!condition) throw Error(reason);};

function proofForSha(sourceSha, runs, jobsByRun, artifactsByRun) {
  const matching = runs.filter(run => run && run.name === R116.name &&
    run.head_sha === sourceSha && run.head_branch === 'main' &&
    run.event === 'workflow_run');
  matching.sort((a, b) => Number(b.id) - Number(a.id));
  if (!matching.length) return {status:'PENDING', reason:'NO_SAME_SHA_LIVE_VPS_RUN'};
  const run = matching[0];
  demand(Number.isSafeInteger(run.id) && run.id > 0, 'Invalid R116 run id');
  const identity = {
    runId:run.id, url:'https://github.com/' + REPO + '/actions/runs/' + run.id,
  };
  if (run.status !== 'completed')
    return {...identity, status:'PENDING', reason:'LIVE_VPS_RUN_NOT_FINISHED'};
  if (run.conclusion !== 'success')
    return {...identity, status:'FAIL', reason:'LIVE_VPS_RUN_' +
      String(run.conclusion || 'UNKNOWN').toUpperCase().slice(0,30)};
  const jobs = jobsByRun[String(run.id)];
  if (!Array.isArray(jobs))
    return {...identity, status:'PENDING', reason:'LIVE_VPS_JOBS_NOT_AVAILABLE'};
  const conclusions = {};
  let incomplete = false, rejected = false;
  for (const name of R116.requiredJobs) {
    const job = jobs.filter(j => j && j.name === name)
      .sort((a,b) => Number(b.id) - Number(a.id))[0];
    conclusions[name] = job?.conclusion ?? 'missing';
    if (!job || job.status !== 'completed') incomplete = true;
    else if (job.conclusion !== 'success') rejected = true;
  }
  if (rejected || incomplete) {
    return {
      ...identity,status:rejected?'FAIL':'PENDING',
      reason:rejected?'PROOF_JOB_FAILED_OR_SKIPPED':'PROOF_JOB_MISSING_OR_UNFINISHED',
      jobs:conclusions,
    };
  }
  // A completed-success R116 job can otherwise be a zero-work superseded-SHA
  // branch that exited 0. The R116 artifact is created ONLY after the actual
  // SSH checks pass and is associated with this exact same workflow run.
  const artifacts=artifactsByRun?.[String(run.id)];
  const valid=Array.isArray(artifacts)&&artifacts.length<=100?
    artifacts.filter(a=>a?.name==='marcosa-r116-actual-vps-rollback-proof'):[];
  if(valid.length!==1 || !Number.isSafeInteger(valid[0].id) || valid[0].id<=0 ||
     valid[0].expired!==false || !Number.isSafeInteger(valid[0].size_in_bytes) ||
     valid[0].size_in_bytes<100 || valid[0].size_in_bytes>16384 ||
     (valid[0].workflow_run && valid[0].workflow_run.id!==run.id)) {
    return {...identity,status:'FAIL',reason:'NO_VERIFIED_ACTUAL_VPS_R116_ARTIFACT',
      jobs:conclusions};
  }
  return {...identity,status:'PASS',reason:'LIVE_ROLLBACK_READINESS_CONFIRMED',
    jobs:conclusions,actualVpsProofArtifactId:valid[0].id};

}

export function evaluateCertificate({sourceSha, mainSha, runs, jobsByRun, artifactsByRun}={}) {
  demand(SHA40.test(sourceSha || '') && SHA40.test(mainSha || ''),
    'Exact main and release SHA required');
  demand(Array.isArray(runs) && runs.length <= 500, 'Bounded workflow evidence required');
  demand(jobsByRun && typeof jobsByRun === 'object', 'Job evidence required');
  const dual = evaluateRelease({sourceSha, mainSha, runs, jobsByRun});
  const rollback = proofForSha(sourceSha, runs, jobsByRun, artifactsByRun);
  const checks = [dual.channels.pages.status, dual.channels.staging.status, rollback.status];
  const status = sourceSha !== mainSha ? 'SUPERSEDED' :
    checks.includes('FAIL') ? 'FAIL' :
    checks.every(x => x === 'PASS') ? 'PASS' : 'PENDING';
  return {
    format:'MARCOSA-R117-TRIPLE-PROOF-PREVIEW-CERTIFICATE-v1',
    sourceSha, mainSha, status,
    evidence:{
      publicPages:dual.channels.pages,
      restrictedContaboStaging:dual.channels.staging,
      verifiedVpsRollbackCandidate:rollback,
    },
    scope:'public_static_preview_only',
    previewUrl:'https://osmanosmanov6880-bot.github.io/marcosa-fusion/',
    productionDomain:'https://marcosa.club/',
    productionAuthorized:false,
    productionCutoverVerified:false,
    publicStagingHttpsVerified:false,
    databaseBackupOrRestoreVerified:false,
    privateAuthOrAccountMigrationVerified:false,
    explanation:'This certificate is a snapshot of public preview, restricted STAGING, and read-only rollback readiness. It never permits production cutover.',
  };
}

async function requestJson(path, token) {
  demand(path.startsWith('git/ref/heads/main') || path.startsWith('actions/'),
    'Only fixed read-only repository endpoints');
  demand(typeof token === 'string' && token.length > 10, 'GitHub token missing');
  const response = await fetch(API + path, {
    method:'GET',redirect:'error',
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:'Bearer ' + token,
      'X-GitHub-Api-Version':'2022-11-28',
    }, signal:AbortSignal.timeout(12000),
  });
  demand(response.ok, 'GitHub API ' + response.status + ' for ' + path.split('?')[0]);
  const body = await response.text();
  demand(body.length < 2 * 1024 * 1024, 'Oversized GitHub API response');
  return JSON.parse(body);
}

async function collectEvidence(sha, token) {
  const [ref, pages, staging, rollback] = await Promise.all([
    requestJson('git/ref/heads/main', token),
    requestJson('actions/workflows/' + PIPELINES.pages.file +
      '/runs?per_page=60&head_sha=' + sha, token),
    requestJson('actions/workflows/' + PIPELINES.staging.file +
      '/runs?per_page=60&head_sha=' + sha, token),
    requestJson('actions/workflows/' + R116.file +
      '/runs?per_page=60&head_sha=' + sha, token),
  ]);
  const mainSha = ref?.object?.sha;
  demand(SHA40.test(mainSha || ''), 'Current main could not be verified');
  for (const channel of [pages, staging, rollback])
    demand(Array.isArray(channel?.workflow_runs), 'Missing workflow run listing');
  const runs = [pages, staging, rollback].flatMap(x => x.workflow_runs)
    .filter(x => x.head_sha === sha);
  demand(runs.length <= 500, 'Excessive workflow histories');
  const wanted = [
    {name:PIPELINES.pages.name, event:['push','workflow_dispatch']},
    {name:PIPELINES.staging.name, event:['push','workflow_dispatch']},
    {name:R116.name, event:['workflow_run']},
  ];
  const latest = wanted.map(c => runs.filter(r => r.name === c.name &&
    r.head_branch === 'main' && c.event.includes(r.event))
    .sort((a,b) => Number(b.id) - Number(a.id))[0]).filter(Boolean);
  const jobsByRun = {};
  const artifactsByRun = {};
  await Promise.all(latest.filter(r => r.status === 'completed' &&
      r.conclusion === 'success').map(async r => {
    demand(Number.isSafeInteger(r.id) && r.id > 0, 'Invalid workflow id');
    const response = await requestJson('actions/runs/' + r.id + '/jobs?per_page=100',token);
    demand(Array.isArray(response.jobs), 'Missing workflow jobs');
    jobsByRun[String(r.id)] = response.jobs;
    if(r.name===R116.name) {
      const items=await requestJson('actions/runs/' + r.id + '/artifacts?per_page=100',token);
      demand(Array.isArray(items.artifacts),'Missing R116 proof artifact list');
      artifactsByRun[String(r.id)]=items.artifacts;
    }
  }));
  return evaluateCertificate({sourceSha:sha, mainSha, runs, jobsByRun, artifactsByRun});
}

/**
 * Validate the ACTUAL JSON bytes downloaded from the GitHub Actions R116 run.
 * GitHub's artifact metadata alone would not prove the attested SHA and
 * read-only SSH operation were reported in the artifact content.
 */
export function verifyR116ProofPayload(payload,{expectedSha,runId}={}){
  demand(SHA40.test(expectedSha||'')&&Number.isSafeInteger(runId)&&runId>0,
    'Exact R116 proof source required');
  demand(payload&&typeof payload==='object'&&!Array.isArray(payload)&&
    payload.format==='MARCOSA-R116-ACTUAL-NONROOT-VPS-ROLLBACK-PROOF-v1'&&
    payload.sourceSha===expectedSha&&
    SHA40.test(payload.previousReleaseSha||'')&&
    Number.isSafeInteger(payload.rollbackCandidateAssetsVerified)&&
    payload.rollbackCandidateAssetsVerified>=3&&
    payload.rollbackCandidateAssetsVerified<=99999&&
    payload.actualReadOnlyVpsSshCheck===true&&
    payload.previousFilesAndManifestSha256Verified===true&&
    payload.productionChanged===false&&
    payload.productionAuthorized===false&&payload.status==='PASS',
    'R116 downloaded proof does not attest actual nonroot read-only SSH');
  return Object.freeze({
    actualR116VpsArtifactContent:'PASS',
    actualR116VpsProofRunId:runId,
    actualR116VpsSourceSha:expectedSha,
    previousReleaseSha:payload.previousReleaseSha,
    rollbackCandidateAssetsVerified:payload.rollbackCandidateAssetsVerified,
    productionAuthorized:false,
  });
}
function downloadAndVerifyR116Proof({sha,rollback,token}){
  demand(rollback?.status==='PASS'&&
    Number.isSafeInteger(rollback.runId)&&rollback.runId>0&&
    Number.isSafeInteger(rollback.actualVpsProofArtifactId)&&
    rollback.actualVpsProofArtifactId>0,
    'R116 actual VPS evidence has not passed');
  demand(typeof token==='string'&&token.length>10,'GitHub action token missing');
  const tmp=mkdtempSync(join(tmpdir(),'marcosa-r116-proof-'));
  try{
    execFileSync('gh',[
      'run','download',String(rollback.runId),'--repo',REPO,
      '--name','marcosa-r116-actual-vps-rollback-proof',
      '--dir',tmp
    ],{env:{...process.env,GH_TOKEN:token},timeout:30000,
      encoding:'utf8',maxBuffer:65536,stdio:['ignore','pipe','pipe']});
    const data=readFileSync(join(tmp,'marcosa-r116-actual-vps-rollback-proof.json'));
    demand(data.length>50&&data.length<=16384,'Oversized or missing real R116 JSON');
    return verifyR116ProofPayload(JSON.parse(data.toString('utf8')),
      {expectedSha:sha,runId:rollback.runId});
  }finally{
    rmSync(tmp,{recursive:true,force:true});
  }
}

async function main() {
  demand(process.env.GITHUB_REPOSITORY === REPO, 'Wrong repository');
  const sourceSha = process.env.RELEASE_SHA;
  demand(SHA40.test(sourceSha || ''), 'Invalid source SHA');
  const report = await collectEvidence(sourceSha, process.env.GITHUB_TOKEN);
  if(report.status==='PASS'){
    const verified=downloadAndVerifyR116Proof({
      sha:sourceSha,
      rollback:report.evidence.verifiedVpsRollbackCandidate,
      token:process.env.GITHUB_TOKEN,
    });
    report.evidence.verifiedVpsRollbackCandidate={
      ...report.evidence.verifiedVpsRollbackCandidate,...verified,
    };
    console.log('R117_R116_ACTUAL_VPS_PROOF_JSON=PASS');
  }
  writeFileSync('marcosa-r117-release-certificate.json',
    JSON.stringify(report,null,2) + '\n',{flag:'wx',mode:0o600});
  console.log('R117_TRIPLE_PROOF_CERTIFICATE=' + report.status);
  console.log('R117_PAGES=' + report.evidence.publicPages.status);
  console.log('R117_STAGING=' + report.evidence.restrictedContaboStaging.status);
  console.log('R117_LIVE_ROLLBACK=' + report.evidence.verifiedVpsRollbackCandidate.status);
  console.log('R117_PRODUCTION_AUTHORIZED=NO');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### MARCOSA R117 — three independent preview release proofs',
      '- Reviewed exact SHA: ' + report.sourceSha,
      '- Public GitHub Pages HTTPS: ' + report.evidence.publicPages.status,
      '- Restricted Contabo STAGING: ' + report.evidence.restrictedContaboStaging.status,
      '- Actual VPS rollback candidate checked READ ONLY: ' + report.evidence.verifiedVpsRollbackCandidate.status,
      '- Release certificate: **' + report.status + '**',
      '- Production cutover, auth migration, and database recovery are NOT authorized.',
      '',
    ].join('\n'));
  }
  if (report.status !== 'PASS') process.exitCode=3;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {await main();}
  catch(error) {
    console.error('R117_CERTIFICATE_ERROR=' + String(error.message || error).slice(0,180));
    process.exitCode=2;
  }
}
