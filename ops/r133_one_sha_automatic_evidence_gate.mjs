#!/usr/bin/env node
/**
 * MARCOSA R133: one exact-main automated evidence gate (read-only GitHub API).
 * It cannot authorize production. It rejects green workflows with skipped
 * server jobs, stale SHA, expired/cross-run artifacts and PENDING R114 reports.
 * Real Auth/Storage, R117-R122, legacy parity and human GO remain separate.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,appendFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyR136Trigger} from './r136_trusted_r116_trigger.mjs';

export const REPO='osmanosmanov6880-bot/marcosa-fusion';
export const FORMAT='MARCOSA-R133-SAME-SHA-AUTOMATED-EVIDENCE-NO-GO-v1';
const SHA=/^[a-f0-9]{40}$/;
const fail=(ok,msg)=>{if(!ok)throw Error(msg);};
const goodId=n=>Number.isSafeInteger(n)&&n>0&&n<1000000000000000;
export const STAGES=Object.freeze({
  r48:Object.freeze({
    file:'marcosa-r48-release-gate.yml',
    name:'MARCOSA | R48 release evidence validator (no deployment)',
    jobs:['contract-tests'],event:'push',
  }),
  pages:Object.freeze({
    file:'marcosa-public-pages.yml',
    name:'MARCOSA | Publish public Network OS preview',
    jobs:['verify-and-build','publish','verify-public-bytes'],event:'push',
  }),
  staging:Object.freeze({
    file:'marcosa-staging.yml',
    name:'MARCOSA | Build, test and deploy STAGING',
    jobs:['build','deploy_ssh_filesystem'],event:'push',
  }),
  r114:Object.freeze({
    file:'marcosa-r114-release-evidence.yml',
    name:'MARCOSA | R114 dual-channel SAME-SHA release evidence',
    jobs:['offline-contract','release-evidence'],event:'workflow_run',
    artifact:'marcosa-r114-release-evidence',
    filename:'marcosa-r114-release-evidence.json',
  }),
  r116:Object.freeze({
    file:'marcosa-r116-rollback-readiness.yml',
    name:'MARCOSA | R116 read-only live VPS rollback readiness after each STAGING release',
    jobs:['offline-rehearsal','read-only-vps-proof'],event:'workflow_run',
    artifact:'marcosa-r116-actual-vps-rollback-proof',
    filename:'marcosa-r116-actual-vps-rollback-proof.json',
  }),
});
export const MANUAL_BLOCKERS=Object.freeze([
  'R132_CURRENT_MAIN_PRODUCTION_ROOT_MANUAL_READONLY',
  'R117_EXPLICIT_MANUAL_TRIPLE_PROOF_CERTIFICATE',
  'R118_TWO_DISTINCT_MANUAL_REAL_VPS_PARITY_JOBS',
  'R121_TWO_DISTINCT_REAL_VPS_PUBLIC_INVENTORIES',
  'R122_R127_TWO_PARENT_INDEPENDENT_READONLY_PROOF',
  'LEGACY_FIVE_MODULES_AND_AUTH_API_ROUTE_RUNTIME_PARITY',
  'REAL_AUTH_POSTGRES_STORAGE_RECOVERY_AND_TWO_TENANT_JWT_RLS',
  'SECURITY_PRIVACY_ROLLBACK_AND_OWNER_GO',
]);
function inspectArtifact(stage,entry,runId){
  if(!stage.artifact)return;
  const listing=entry.artifacts;
  fail(listing&&Array.isArray(listing.artifacts)&&
    Number.isSafeInteger(listing.total_count)&&
    listing.total_count===listing.artifacts.length&&
    listing.total_count<=100,'Incomplete GitHub artifact listing for '+stage.file);
  const match=listing.artifacts.filter(x=>x?.name===stage.artifact);
  fail(match.length===1&&goodId(match[0].id)&&
    match[0].workflow_run?.id===runId&&
    match[0].expired===false&&
    Number.isSafeInteger(match[0].size_in_bytes)&&
    match[0].size_in_bytes>80&&match[0].size_in_bytes<65536,
    'Missing, expired, duplicated or wrong-run actual GitHub artifact for '+stage.file);
  const report=entry.report;
  fail(report&&typeof report==='object'&&!Array.isArray(report),
    'Real downloaded bounded artifact JSON required: '+stage.artifact);
}
function inspectReport(key,report,sha){
  if(key==='r114'){
    fail(report.format==='MARCOSA-R114-DUAL-RELEASE-EVIDENCE-v1'&&
      report.sourceSha===sha&&report.mainSha===sha&&
      report.currentMain===true&&report.status==='PASS'&&
      report.channels?.pages?.status==='PASS'&&
      report.channels?.staging?.status==='PASS'&&
      report.sourceBasedPublicPagesVerified===true&&
      report.sourceBasedRestrictedStagingVerified===true&&
      report.productionAuthorized===false&&
      report.productionCutoverVerified===false&&
      report.privateAccountsOrDatabaseVerified===false,
      'R114 needs actual same-SHA Pages/STAGING PASS report, never generic green workflow');
  }else if(key==='r116'){
    fail(report.format==='MARCOSA-R116-ACTUAL-NONROOT-VPS-ROLLBACK-PROOF-v1'&&
      report.sourceSha===sha&&
      SHA.test(report.previousReleaseSha||'')&&
      report.previousReleaseSha!==sha&&
      Number.isSafeInteger(report.rollbackCandidateAssetsVerified)&&
      report.rollbackCandidateAssetsVerified>=3&&
      report.actualReadOnlyVpsSshCheck===true&&
      report.previousFilesAndManifestSha256Verified===true&&
      report.productionChanged===false&&
      report.productionAuthorized===false&&
      report.status==='PASS',
      'R116 needs actual VPS read-only SSH proof, exact SHA and NO production changes');
  }
}
export function evaluateGate({sourceSha,currentMainSha,evidence}={}){
  fail(SHA.test(sourceSha||'')&&SHA.test(currentMainSha||'')&&
    sourceSha===currentMainSha,
    'R133 requires exact current main SHA, never stale release evidence');
  fail(evidence&&typeof evidence==='object'&&!Array.isArray(evidence),
    'All independent GitHub evidence required');
  const results={};
  const seenRuns=new Set(),seenArtifacts=new Set();
  for(const [key,stage] of Object.entries(STAGES)){
    const entry=evidence[key],run=entry?.run;
    fail(run&&goodId(run.id)&&
      run.name===stage.name&&
      run.head_sha===sourceSha&&
      run.head_branch==='main'&&
      run.head_repository?.full_name===REPO&&
      run.event===stage.event&&
      run.status==='completed'&&
      run.conclusion==='success'&&!seenRuns.has(run.id),
      'Exact-main '+key+' workflow missing, stale, duplicated, skipped or not success');
    seenRuns.add(run.id);
    const listing=entry.jobs;
    fail(listing&&Array.isArray(listing.jobs)&&
      Number.isSafeInteger(listing.total_count)&&
      listing.total_count===listing.jobs.length&&
      listing.total_count<=100,
      'Incomplete GitHub jobs listing for '+key);
    const checked={};
    for(const name of stage.jobs){
      const matches=listing.jobs.filter(x=>x?.name===name);
      fail(matches.length===1&&goodId(matches[0].id)&&
        matches[0].status==='completed'&&
        matches[0].conclusion==='success'&&
        (!matches[0].head_sha||matches[0].head_sha===sourceSha),
        key+' real required job '+name+' was skipped, missing, stale or not success');
      checked[name]='PASS';
    }
    if(stage.artifact){
      inspectArtifact(stage,entry,run.id);
      inspectReport(key,entry.report,sourceSha);
      const id=entry.artifacts.artifacts.find(x=>x.name===stage.artifact).id;
      fail(!seenArtifacts.has(id),'Duplicate evidence artifact ID across stages');
      seenArtifacts.add(id);
    }
    results[key]={status:'PASS',runId:run.id,jobs:checked,
      ...(stage.artifact?{independentArtifactValidated:true}:{})};
  }
  return Object.freeze({
    format:FORMAT,sourceSha,currentMainSha,
    status:'AUTOMATIC_PREVIEW_AND_READONLY_ROLLBACK_PROOFS_PASS',
    stages:results,automaticEvidenceStages:5,
    requiredManualEvidenceNotProven:[...MANUAL_BLOCKERS],
    realCustomerAuthStorageOrDatabaseMigrated:false,
    privateProductionDataInspected:false,
    productionRootModified:false,
    productionCutoverAuthorized:false,
    productionDecision:'NO_GO',
    note:'Five independently checked current SHA preview, staging and VPS rollback proofs; NO authorization for production migration. Real manual audits and customer data recovery are separate hard blockers.',
  });
}
async function githubGet(path,token){
  fail(/^\/(git\/ref\/heads\/main|actions\/(?:workflows\/marcosa-[a-z0-9-]+\.yml\/runs|runs\/[1-9][0-9]*(?:\/(?:jobs|artifacts))?))(\?.*)?$/.test(path),
    'Untrusted GitHub path');
  const url='https://api.github.com/repos/'+REPO+path;
  const r=await fetch(url,{method:'GET',redirect:'error',headers:{
    Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
  },signal:AbortSignal.timeout(15000)});
  fail(r.ok,'GitHub read-only API returned '+r.status);
  const body=await r.text();
  fail(body.length>=2&&body.length<=2*1024*1024,
    'GitHub evidence response outside safe size');
  return JSON.parse(body);
}
function downloadedProof(run,stage){
  const folder=mkdtempSync(join(tmpdir(),'marcosa-r133-'));
  try{
    execFileSync('gh',['run','download',String(run.id),'--repo',REPO,
      '--name',stage.artifact,'--dir',folder],{
      timeout:25000,maxBuffer:8192,stdio:['ignore','pipe','pipe'],
    });
    const file=join(folder,stage.filename);
    const stat=lstatSync(file);
    fail(stat.isFile()&&!stat.isSymbolicLink()&&
      stat.size>80&&stat.size<65536,
      'Downloaded GitHub evidence report missing or oversized');
    return JSON.parse(readFileSync(file,'utf8'));
  }finally{rmSync(folder,{recursive:true,force:true});}
}
async function collect(sha,token){
  const main=await githubGet('/git/ref/heads/main',token);
  fail(main.object?.sha===sha,'GitHub main advanced; stale R133 source blocked');
  const data={};
  for(const [key,stage] of Object.entries(STAGES)){
    const p='/actions/workflows/'+stage.file+
      '/runs?branch=main&head_sha='+sha+'&per_page=100';
    const result=await githubGet(p,token);
    fail(Array.isArray(result.workflow_runs)&&
      Number.isSafeInteger(result.total_count)&&
      result.total_count===result.workflow_runs.length&&
      result.total_count<=100,
      'Incomplete current SHA workflow run page for '+key);
    const runs=result.workflow_runs.filter(x=>x.name===stage.name);
    runs.sort((a,b)=>b.id-a.id);
    fail(runs.length>=1,'Missing exact-SHA workflow run for '+key);
    const run=runs[0];
    fail(goodId(run.id),'Invalid GitHub run identifier');
    const jobs=await githubGet('/actions/runs/'+run.id+'/jobs?per_page=100',token);
    let artifacts,report;
    if(stage.artifact){
      artifacts=await githubGet('/actions/runs/'+run.id+'/artifacts?per_page=100',token);
      // Download only the declared bounded JSON; never raw production files.
      const matches=artifacts.artifacts?.filter(x=>x.name===stage.artifact)||[];
      fail(matches.length===1&&matches[0].expired===false&&
        matches[0].workflow_run?.id===run.id,
        'Exact-run GitHub NO_GO artifact missing for '+key);
      report=downloadedProof(run,stage);
    }
    data[key]={run,jobs,artifacts,report};
  }
  const after=await githubGet('/git/ref/heads/main',token);
  fail(after.object?.sha===sha,'GitHub main moved mid-audit; cannot attest stale source');
  return data;
}
async function main(){
  fail(process.argv.length===2,'R133 takes no arbitrary arguments');
  // Manual R133 remains available; automatic R136 accepts ONLY a trusted
  // completed R116 event. Both must match the checked-out current main.
  const sourceSha=process.env.GITHUB_SHA;
  const eventName=process.env.GITHUB_EVENT_NAME;
  let payload;
  if(eventName!=='workflow_dispatch'){
    fail(typeof process.env.GITHUB_EVENT_PATH==='string',
      'R136 trusted event file required');
    payload=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  }
  verifyR136Trigger({
    eventName,repository:process.env.GITHUB_REPOSITORY,
    ref:process.env.GITHUB_REF,sourceSha,payload,
  });
  fail(SHA.test(sourceSha||''),'No exact main SHA');
  const checkout=execFileSync('git',['rev-parse','HEAD'],{
    encoding:'utf8',timeout:8000}).trim();
  fail(checkout===sourceSha,'Checked-out source SHA mismatched GitHub event');
  const token=process.env.GH_TOKEN;
  fail(token&&token.length>15,'Only GitHub-provided read-only token permitted');
  const evidence=await collect(sourceSha,token);
  const result=evaluateGate({sourceSha,currentMainSha:sourceSha,evidence});
  writeFileSync('marcosa-r133-one-sha-automatic-proof.json',
    JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R133_AUTOMATIC_EVIDENCE_SAME_SHA=PASS');
  console.log('R133_MANUAL_AND_CUSTOMER_DATA_GATES=NOT_VERIFIED');
  console.log('R133_PRODUCTION=NO_GO');
  if(process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      '## R133: exact-main automatic evidence',
      '- Source: '+sourceSha,
      '- R48, Pages, STAGING, R114, actual VPS R116: PASS',
      '- Independent manual evidence not verified: '+MANUAL_BLOCKERS.length+' blockers',
      '- Production: **NO-GO**','','',
    ].join('\n'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(e){
    console.error('R133_FAIL_CLOSED='+String(e.message||e).slice(0,200));
    process.exitCode=2;
  }
}
