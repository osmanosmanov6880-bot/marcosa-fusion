#!/usr/bin/env node
/**
 * MARCOSA R117: machine-readable, fail-closed PREVIEW release certificate.
 *
 * A PASS needs the same reviewed git SHA in GitHub Pages HTTPS readback,
 * verified Contabo SSH staging deployment, and R116's REAL read-only VPS
 * rollback-candidate verification. No SSH, production, database, or writes.
 */
import {writeFileSync, appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
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

function proofForSha(sourceSha, runs, jobsByRun) {
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
  return {
    ...identity,
    status:rejected ? 'FAIL' : incomplete ? 'PENDING' : 'PASS',
    reason:rejected ? 'PROOF_JOB_FAILED_OR_SKIPPED' :
      incomplete ? 'PROOF_JOB_MISSING_OR_UNFINISHED' : 'LIVE_ROLLBACK_READINESS_CONFIRMED',
    jobs:conclusions,
  };
}

export function evaluateCertificate({sourceSha, mainSha, runs, jobsByRun}={}) {
  demand(SHA40.test(sourceSha || '') && SHA40.test(mainSha || ''),
    'Exact main and release SHA required');
  demand(Array.isArray(runs) && runs.length <= 500, 'Bounded workflow evidence required');
  demand(jobsByRun && typeof jobsByRun === 'object', 'Job evidence required');
  const dual = evaluateRelease({sourceSha, mainSha, runs, jobsByRun});
  const rollback = proofForSha(sourceSha, runs, jobsByRun);
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
  await Promise.all(latest.filter(r => r.status === 'completed' &&
      r.conclusion === 'success').map(async r => {
    demand(Number.isSafeInteger(r.id) && r.id > 0, 'Invalid workflow id');
    const response = await requestJson('actions/runs/' + r.id + '/jobs?per_page=100',token);
    demand(Array.isArray(response.jobs), 'Missing workflow jobs');
    jobsByRun[String(r.id)] = response.jobs;
  }));
  return evaluateCertificate({sourceSha:sha, mainSha, runs, jobsByRun});
}

async function main() {
  demand(process.env.GITHUB_REPOSITORY === REPO, 'Wrong repository');
  const sourceSha = process.env.RELEASE_SHA;
  demand(SHA40.test(sourceSha || ''), 'Invalid source SHA');
  const report = await collectEvidence(sourceSha, process.env.GITHUB_TOKEN);
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
