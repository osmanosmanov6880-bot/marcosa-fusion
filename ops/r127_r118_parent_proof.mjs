#!/usr/bin/env node
/**
 * MARCOSA R127: prove BOTH source R118 audits again inside R122 using exact
 * GitHub run/job/artifact APIs and the original, bounded NO_GO JSON bytes.
 * Unlike R126, an R121-reported parent ID cannot itself authorize a result.
 * No SSH, customer data, filesystem changes on servers or production cutover.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyR118LiveEvidence} from './r123_upstream_live_gate.mjs';

export const FORMAT='MARCOSA-R127-INDEPENDENT-TWO-R118-PARENT-PROOF-v1';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const R121_FORMAT='MARCOSA-R121-VERIFIED-PUBLIC-FILE-HASH-BASELINE-v1';
const SHA=/^[0-9a-f]{40}$/;
const demand=(yes,msg)=>{if(!yes)throw Error(msg)};
const positive=x=>Number.isSafeInteger(x)&&x>0&&x<=999999999999999;
const read=(path,max=65536)=>{
  const bytes=readFileSync(path);
  demand(bytes.length>2&&bytes.length<=max,'Missing/oversized fixed evidence JSON');
  return JSON.parse(bytes.toString('utf8'));
};
export function extractParentIds({expectedSha,firstReport,secondReport}={}){
  demand(SHA.test(expectedSha||''),'Current exact source SHA required');
  function from(report){
    demand(report&&typeof report==='object'&&!Array.isArray(report)&&
      report.format===R121_FORMAT&&report.sourceSha===expectedSha&&
      report.status==='PASS'&&report.verdict==='NO_GO'&&
      report.verifiedR118NonrootVpsAttestation===true&&
      positive(report.verifiedR118UpstreamRunId)&&
      report.noProductionChangesMade===true&&
      report.mainProductionRootCutoverAuthorized===false,
      'R121 parent identity untrusted');
    return report.verifiedR118UpstreamRunId;
  }
  const a=from(firstReport),b=from(secondReport);
  demand(a!==b,'Two distinct R118 parent IDs required');
  return Object.freeze([a,b]);
}
export function verifyParentPair({expectedSha,parentIds,first,second}={}){
  demand(SHA.test(expectedSha||''),'Current exact source SHA required');
  demand(Array.isArray(parentIds)&&parentIds.length===2&&
    positive(parentIds[0])&&positive(parentIds[1])&&parentIds[0]!==parentIds[1],
    'Distinct bounded R118 parent IDs required');
  const source=[first,second];
  const checks=source.map((item,i)=>{
    demand(item&&typeof item==='object'&&item.run?.event==='workflow_dispatch',
      'Only operator-dispatched real R118 audits are accepted');
    const good=verifyR118LiveEvidence({
      repository:REPO,expectedSha,upstreamRunId:parentIds[i],
      run:item.run,jobs:item.jobs,artifacts:item.artifacts,report:item.report,
    });
    demand(good.r118RunId===parentIds[i]&&
      good.actualNonrootVpsParityJob==='PASS'&&
      good.boundedR118NoGoArtifact==='PASS'&&
      good.productionCutoverAuthorized===false&&
      good.productionFilesChanged===false,
      'R118 true VPS parent evidence absent');
    return good;
  });
  demand(checks[0].r118RunId!==checks[1].r118RunId,
    'Repeated R118 audit is not an independent source');
  return Object.freeze({
    format:FORMAT,sourceSha:expectedSha,
    verifiedR118ParentRunIds:[...parentIds],
    manualWorkflowDispatchVerified:true,
    independentReadOnlyVpsJobsVerified:true,
    boundedNoGoArtifactsVerified:true,
    verifiedUsingGitHubApi:true,
    productionCutoverAuthorized:false,
    productionFilesChanged:false,
    customerAuthStorageOrDatabaseVerified:false,
    status:'PASS',verdict:'NO_GO',
  });
}
function main(){
  demand(process.env.GITHUB_REPOSITORY===REPO,'Unexpected GitHub repository');
  demand(process.argv.length===3,'Only two approved fixed-path commands');
  const expectedSha=process.env.RELEASE_SHA;
  if(process.argv[2]==='--extract'){
    const ids=extractParentIds({
      expectedSha,
      firstReport:read('r122-a-report.json'),
      secondReport:read('r122-b-report.json'),
    });
    writeFileSync('r122-r118-parent-ids.txt',ids.join('\n')+'\n',
      {flag:'wx',mode:0o600});
    console.log('R127_DISTINCT_PARENT_IDS_EXTRACTED=YES');
  }else if(process.argv[2]==='--verify'){
    const lines=readFileSync('r122-r118-parent-ids.txt','utf8').trim().split(/\r?\n/);
    demand(lines.length===2&&lines.every(x=>/^[1-9][0-9]{0,14}$/.test(x)),
      'Two canonical R118 parent IDs are required');
    const ids=lines.map(Number);
    demand(lines.every((x,i)=>String(ids[i])===x),'Non-canonical source ID');
    const make=suffix=>({
      run:read('r122-'+suffix+'-r118-run.json'),
      jobs:read('r122-'+suffix+'-r118-jobs.json'),
      artifacts:read('r122-'+suffix+'-r118-artifacts.json'),
      report:read('r122-'+suffix+'-r118-report.json'),
    });
    const proof=verifyParentPair({
      expectedSha,parentIds:ids,first:make('a'),second:make('b'),
    });
    writeFileSync('r122-verified-r118-parents.json',JSON.stringify(proof,null,2)+'\n',
      {flag:'wx',mode:0o600});
    console.log('R127_INDEPENDENT_R118_GITHUB_API_ATTESTATION=PASS');
    console.log('R127_PRODUCTION_CUTOVER_AUTHORIZED=NO');
  }else{
    throw Error('Unknown R127 command');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main()}catch(e){console.error('R127_PARENT_ATTESTATION_REFUSED='+
    String(e.message||e).slice(0,175));process.exitCode=2}
}
