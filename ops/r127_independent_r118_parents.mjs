#!/usr/bin/env node
/**
 * R127: independently attest BOTH real upstream R118 VPS audits referenced
 * by the two actual R121 public-hash reports that R122 already validated.
 * Inputs are bounded, exact-run GitHub API metadata and NO_GO JSON artifacts.
 * No production mutation, private data export, remote SSH, or implicit GO.
 */
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyR118LiveEvidence} from './r123_upstream_live_gate.mjs';

export const REPO='osmanosmanov6880-bot/marcosa-fusion';
export const FORMAT='MARCOSA-R127-TWO-INDEPENDENT-R118-API-ATTESTATIONS-v1';
const R122_FORMAT='MARCOSA-R122-DOUBLE-INDEPENDENT-REAL-VPS-PUBLIC-PROOF-v1';
const R118_ARTIFACT='marcosa-r118-production-boundary-no-go';
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const demand=(yes,reason)=>{if(!yes)throw Error(reason);};
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<1000000000000000;

function readJsonFixed(name,max=65536){
  const bytes=readFileSync(name);
  demand(bytes.length>=2&&bytes.length<=max,'Missing or oversized R127 read-only evidence');
  return JSON.parse(bytes.toString('utf8'));
}

export function extractParentIds({expectedSha,first,second}={}){
  demand(SHA40.test(expectedSha||''),'Exact current main SHA required');
  demand(first&&second&&first.sourceSha===expectedSha&&
    second.sourceSha===expectedSha&&first.status==='PASS'&&
    second.status==='PASS','Trusted same-SHA R121 reports required');
  const ids=[first.verifiedR118UpstreamRunId,second.verifiedR118UpstreamRunId];
  demand(ids.every(positive)&&ids[0]!==ids[1],
    'Two distinct exact parent R118 run IDs required');
  return ids;
}

function verifyParent({expectedSha,reportedParentId,r121Report,parent}={}){
  demand(positive(reportedParentId),'Valid parent R118 run ID required');
  demand(r121Report&&r121Report.sourceSha===expectedSha&&
    r121Report.status==='PASS'&&
    r121Report.verifiedR118UpstreamRunId===reportedParentId&&
    r121Report.verifiedR118NonrootVpsAttestation===true&&
    r121Report.mainProductionRootCutoverAuthorized===false&&
    r121Report.customerStorageOrAuthInspected===false&&
    r121Report.verdict==='NO_GO',
    'R121 report is stale, drifted or unbound to this R118 parent');
  const {run,jobs,artifacts,report}=parent||{};
  demand(run?.event==='workflow_dispatch',
    'Parent R118 must be an explicitly dispatched main audit');
  demand(jobs&&Array.isArray(jobs.jobs)&&jobs.jobs.length>=2&&
    jobs.jobs.length<=100&&
    (jobs.total_count===undefined||jobs.total_count===jobs.jobs.length),
    'Incomplete R118 real VPS jobs or paginated results');
  demand(artifacts&&Array.isArray(artifacts.artifacts)&&
    artifacts.artifacts.length>=1&&artifacts.artifacts.length<=100&&
    (artifacts.total_count===undefined||
      artifacts.total_count===artifacts.artifacts.length),
    'Incomplete R118 artifact listing');
  const artifact=artifacts.artifacts.filter(x=>x?.name===R118_ARTIFACT);
  demand(artifact.length===1&&positive(artifact[0].id)&&
    artifact[0].expired===false&&
    positive(artifact[0].size_in_bytes)&&
    artifact[0].size_in_bytes<65536&&
    artifact[0].workflow_run?.id===reportedParentId,
    'R118 NO_GO artifact must belong to the exact source run');
  const proof=verifyR118LiveEvidence({
    repository:REPO,expectedSha,upstreamRunId:reportedParentId,
    run,jobs,artifacts,report,
  });
  demand(proof.actualNonrootVpsParityJob==='PASS'&&
    proof.boundedR118NoGoArtifact==='PASS'&&
    proof.productionCutoverAuthorized===false,
    'R118 did not independently attest a real read-only VPS job');
  const live=jobs.jobs.filter(x=>x?.name==='live-production-parity');
  demand(live.length===1&&positive(live[0].id),
    'One completed R118 real VPS job ID is required');
  demand(report?.existingRoot&&
    SHA64.test(report.existingRoot.indexSha256||'')&&
    r121Report.verifiedR118OldIndexSha256===report.existingRoot.indexSha256&&
    r121Report.numberOfHashedPublicFiles===
      report.existingRoot.counts?.legacyPublicTopLevel,
    'R121 index/count baseline mismatches actual parent R118 artifact');
  return Object.freeze({
    parentRunId:reportedParentId,
    realR118VpsJobId:live[0].id,
    noGoArtifactId:artifact[0].id,
  });
}

export function verifyTwoParents({expectedSha,first,second,r122}={}){
  demand(SHA40.test(expectedSha||''),'Exact current main SHA required');
  const parentIds=extractParentIds({expectedSha,
    first:first?.r121Report,second:second?.r121Report});
  demand(r122&&r122.format===R122_FORMAT&&r122.sourceSha===expectedSha&&
    r122.status==='PASS'&&r122.productionDecision==='NO_GO'&&
    r122.productionCutoverAuthorized===false&&
    r122.independentlyCompletedVpsJobs===true&&
    Array.isArray(r122.runIds)&&r122.runIds.length===2&&
    positive(r122.runIds[0])&&positive(r122.runIds[1])&&
    r122.runIds[0]!==r122.runIds[1]&&
    Array.isArray(r122.verifiedR118ParentRunIds)&&
    r122.verifiedR118ParentRunIds.length===2&&
    parentIds.every((id,i)=>r122.verifiedR118ParentRunIds[i]===id),
    'R127 refuses absent, DRIFT, unsafe or wrong-run R122 public result');
  const a=verifyParent({expectedSha,reportedParentId:parentIds[0],
    r121Report:first.r121Report,parent:first.parent});
  const b=verifyParent({expectedSha,reportedParentId:parentIds[1],
    r121Report:second.r121Report,parent:second.parent});
  demand(a.realR118VpsJobId!==b.realR118VpsJobId&&
    a.noGoArtifactId!==b.noGoArtifactId,
    'Two independent R118 live job IDs and artifact IDs are mandatory');
  return Object.freeze({
    format:FORMAT,sourceSha:expectedSha,status:'PASS',
    scope:'independent_same_sha_R118_parent_API_and_NO_GO_artifact_check',
    r121RunIds:r122.runIds,
    r118ParentRunIds:parentIds,
    independentlyVerifiedR118ApiAndRealVpsJobs:true,
    r118RealVpsJobIds:[a.realR118VpsJobId,b.realR118VpsJobId],
    r118NoGoArtifactIds:[a.noGoArtifactId,b.noGoArtifactId],
    downstreamR122PublicHashResult:'PASS',
    privateCustomerDataInspected:false,
    authenticationOrDatabaseRecoveryProven:false,
    productionCutoverAuthorized:false,
    productionChanged:false,
    productionDecision:'NO_GO',
    limitations:'GitHub API read-only provenance and public hashes only; not Auth, Postgres, Storage, historical recovery or production release approval.',
  });
}

function main(){
  demand(process.env.GITHUB_REPOSITORY===REPO,'Wrong GitHub repository');
  demand(SHA40.test(process.env.RELEASE_SHA||''),
    'Exact current main commit required');
  const first=readJsonFixed('r122-a-report.json');
  const second=readJsonFixed('r122-b-report.json');
  if(process.argv.length===3&&process.argv[2]==='--parent-ids'){
    const ids=extractParentIds({expectedSha:process.env.RELEASE_SHA,
      first,second});
    process.stdout.write(ids.join('\n')+'\n');
    return;
  }
  demand(process.argv.length===3&&process.argv[2]==='--verify',
    'R127 permits only fixed --parent-ids or --verify modes');
  const readParent=suffix=>({
    r121Report:suffix==='a'?first:second,
    parent:{
      run:readJsonFixed('r122-'+suffix+'-r118-run.json'),
      jobs:readJsonFixed('r122-'+suffix+'-r118-jobs.json'),
      artifacts:readJsonFixed('r122-'+suffix+'-r118-artifacts.json'),
      report:readJsonFixed('r122-'+suffix+'-r118-report.json'),
    },
  });
  const result=verifyTwoParents({
    expectedSha:process.env.RELEASE_SHA,
    first:readParent('a'),second:readParent('b'),
    r122:readJsonFixed('marcosa-r122-double-real-vps-acceptance.json'),
  });
  writeFileSync('marcosa-r127-independent-r118-parent-proof.json',
    JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R127_TWO_REAL_R118_PARENT_API_ATTESTATIONS=PASS');
  console.log('R127_SOURCE_SHA='+result.sourceSha);
  console.log('R127_PRODUCTION_CUTOVER=NO_GO');
  if(process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      '### MARCOSA R127 — independent R118 parent API attestation',
      '- Exact current main SHA: '+result.sourceSha,
      '- Source R118 runs: '+result.r118ParentRunIds.join(', '),
      '- Independent actual R118 VPS jobs and same-run NO_GO artifacts: PASS',
      '- Production cutover: **NO_GO**',
      '- Auth, private Storage, PostgreSQL recovery: NOT VERIFIED',
      '',
    ].join('\n'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(err){
    console.error('R127_PARENT_PROOF_REFUSED='+
      String(err.message||err).slice(0,180));
    process.exitCode=2;
  }
}
