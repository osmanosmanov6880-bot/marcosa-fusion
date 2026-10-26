#!/usr/bin/env node
/**
 * R123: require REAL R118 live-vps job and its bounded NO_GO evidence before
 * permitting R119 synthetic loopback VPS test. A workflow-level "success"
 * is not enough: GitHub may mark an offline-only run successful with the
 * live-production-parity job SKIPPED.
 *
 * GitHub's API authenticates the returned run/job/artifact metadata. This
 * module only checks that metadata and the explicit R118 safety fields;
 * no production credentials, SSH, private files, or modifications.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO='osmanosmanov6880-bot/marcosa-fusion';
const RUN_NAME='MARCOSA | R118 actual production compatibility audit (READ ONLY, NO CUTOVER)';
const ARTIFACT='marcosa-r118-production-boundary-no-go';
const FORMAT='MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1';
const SHA=/^[a-f0-9]{40}$/;
const assert=(yes,msg)=>{if(!yes)throw Error(msg);};
const positive=v=>Number.isSafeInteger(v)&&v>0;
const safe=(key)=>typeof key==='string'&&key.length<150;
export function verifyR118LiveEvidence({repository,expectedSha,upstreamRunId,run,jobs,artifacts,report}={}){
  assert(repository===REPO,'Wrong repository');
  assert(typeof expectedSha==='string'&&SHA.test(expectedSha),'Exact reviewed main SHA required');
  assert(positive(upstreamRunId),'Positive exact R118 run id required');
  assert(run&&typeof run==='object'&&!Array.isArray(run)&&
    run.id===upstreamRunId&&run.name===RUN_NAME&&
    run.head_sha===expectedSha&&run.head_branch==='main'&&
    run.head_repository?.full_name===REPO&&
    (run.event==='workflow_run'||run.event==='workflow_dispatch')&&
    run.status==='completed'&&run.conclusion==='success',
    'Untrusted, skipped, non-main or outdated R118 run');

  assert(jobs&&Array.isArray(jobs.jobs)&&jobs.jobs.length>=2&&jobs.jobs.length<=100,
    'Incomplete R118 job list');
  const live=jobs.jobs.filter(job=>job?.name==='live-production-parity');
  const offline=jobs.jobs.filter(job=>job?.name==='offline-contract');
  assert(live.length===1&&offline.length===1&&
    live[0].status==='completed'&&live[0].conclusion==='success'&&
    offline[0].status==='completed'&&offline[0].conclusion==='success'&&
    (!live[0].head_sha||live[0].head_sha===expectedSha),
    'R118 real read-only VPS job did NOT complete successfully');

  assert(artifacts&&Array.isArray(artifacts.artifacts)&&
    artifacts.artifacts.length<=100,'Incomplete R118 artifacts');
  const found=artifacts.artifacts.filter(x=>x?.name===ARTIFACT);
  assert(found.length===1&&positive(found[0].id)&&found[0].expired===false&&
    positive(found[0].size_in_bytes)&&
    (!found[0].workflow_run||found[0].workflow_run.id===upstreamRunId),
    'Missing live R118 verified NO_GO artifact');

  assert(report&&typeof report==='object'&&!Array.isArray(report)&&
    report.format===FORMAT&&report.sourceSha===expectedSha&&
    report.preliminaryAudit==='PASS'&&
    report.verifiedPreviewScope==='public_static_preview_only'&&
    report.productionDecision==='NO_GO'&&
    report.directRootReplacementAllowed===false&&
    report.productionAuthorized===false&&report.productionChanged===false&&
    report.accountsMigratedOrVerified===false&&
    report.databasesBackedUpAndRestored===false&&
    report.checks?.r117TripleProof==='PASS'&&
    report.checks?.realProductionRootReadOnlyParity==='PASS'&&
    report.checks?.stageShaEqualsAuditedMain===true,
    'R118 artifact is stale, incomplete or claims unsafe production approval');
  const root=report.existingRoot;
  assert(root&&typeof root==='object'&&
    Number.isSafeInteger(root.counts?.legacyPublicTopLevel)&&
    root.counts.legacyPublicTopLevel>=1&&root.counts.legacyPublicTopLevel<=100000&&
    Array.isArray(root.criticalPublicIntegrationNamesPresent)&&
    root.criticalPublicIntegrationNamesPresent.length<=5&&
    root.criticalPublicIntegrationNamesPresent.every(safe),
    'R118 legacy root proof malformed');

  // Never propagate arbitrary raw JSON fields (could contain private data).
  return Object.freeze({
    format:'MARCOSA-R123-VERIFIED-R118-LIVE-UPSTREAM-v1',
    sourceSha:expectedSha,r118RunId:upstreamRunId,
    offlineJob:'PASS',actualNonrootVpsParityJob:'PASS',
    boundedR118NoGoArtifact:'PASS',
    legacyPublicFileCount:root.counts.legacyPublicTopLevel,
    criticalPublicModulesPresent:root.criticalPublicIntegrationNamesPresent.length,
    authorizedToSmokeDisposableLoopbackOnly:true,
    productionCutoverAuthorized:false,
    productionFilesChanged:false,
    productionDatabasesAccessed:false,
    verdict:'R119_EPHEMERAL_DIAGNOSTICS_ONLY',
  });
}

function readJSON(path,max=512*1024){
  const content=readFileSync(path);
  assert(content.length>=2&&content.length<=max,'Empty or oversized attestation JSON');
  return JSON.parse(content.toString('utf8'));
}
function main(){
  assert(process.env.GITHUB_REPOSITORY===REPO,'Wrong GitHub repository');
  assert(process.argv.length===2,'Only approved evidence filenames may be read');
  const result=verifyR118LiveEvidence({
    repository:process.env.GITHUB_REPOSITORY,
    expectedSha:process.env.RELEASE_SHA,
    upstreamRunId:Number(process.env.R118_RUN_ID),
    run:readJSON('r123-r118-run.json'),
    jobs:readJSON('r123-r118-jobs.json'),
    artifacts:readJSON('r123-r118-artifacts.json'),
    report:readJSON('r123-r118-report/marcosa-r118-production-boundary.json',65536),
  });
  // Locally persist only the sanitized, authenticated upstream identity.
  // R121 consumes it before creating a public-file inventory artifact.
  writeFileSync('r123-r118-upstream-proof.json',JSON.stringify(result,null,2)+'\n',
    {flag:'wx',mode:0o600});
  console.log('R123_REAL_R118_NONROOT_VPS_UPSTREAM=PASS');
  console.log('R123_R118_RUN_ID='+result.r118RunId);
  console.log('R123_RELEASE_SHA='+result.sourceSha);
  console.log('R123_R119_SCOPE=EPHEMERAL_LOOPBACK_ONLY');
  console.log('R123_PRODUCTION_CUTOVER_AUTHORIZED=NO');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(error){console.error('R123_UPSTREAM_REFUSED='+String(error.message||error).slice(0,160));
    process.exitCode=2;}
}
