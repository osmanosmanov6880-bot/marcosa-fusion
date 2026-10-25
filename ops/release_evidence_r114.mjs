#!/usr/bin/env node
/* MARCOSA R114 -- evidence of TWO release channels for the SAME exact commit.
   This is an audit of public Pages and restricted Contabo STAGING, NOT a
   production authorization. GitHub API read only; no server/root key accessed.
*/
import {writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO='osmanosmanov6880-bot/marcosa-fusion';
export const PIPELINES=Object.freeze({
 pages:Object.freeze({name:'MARCOSA | Publish public Network OS preview',
  file:'marcosa-public-pages.yml',
  jobs:Object.freeze(['verify-and-build','publish','verify-public-bytes'])}),
 staging:Object.freeze({name:'MARCOSA | Build, test and deploy STAGING',
  file:'marcosa-staging.yml',
  jobs:Object.freeze(['build','deploy_ssh_filesystem'])})
});
const SHA=/^[0-9a-f]{40}$/;
const ID=/^[1-9][0-9]{1,18}$/;
const root='https://api.github.com';
const assert=(value,message)=>{if(!value)throw Error(message);};

export function evaluateRelease({sourceSha,mainSha,runs,jobsByRun}={}){
 assert(SHA.test(sourceSha||'')&&SHA.test(mainSha||''),'Exact 40-character Git commit identities required');
 assert(Array.isArray(runs)&&runs.length<=500,'Bounded GitHub Actions run list required');
 assert(jobsByRun&&typeof jobsByRun==='object','Action job results required');
 const channels={};
 for(const [key,config] of Object.entries(PIPELINES)){
  const candidates=runs.filter(run=>run&&run.name===config.name &&
   run.head_sha===sourceSha&&run.head_branch==='main' &&
   ['push','workflow_dispatch'].includes(run.event));
  candidates.sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0));
  const current=candidates[0];
  if(!current){
   channels[key]={status:'PENDING',reason:'NO_MATCHING_EXACT_SHA_RUN'};
   continue;
  }
  assert(Number.isSafeInteger(current.id)&&current.id>0,'Invalid GitHub run ID');
  const result={id:current.id,url:'https://github.com/'+REPO+'/actions/runs/'+current.id};
  if(current.status!=='completed'){
   channels[key]={...result,status:'PENDING',reason:'RUN_STILL_ACTIVE'};
   continue;
  }
  if(current.conclusion!=='success'){
   channels[key]={...result,status:'FAIL',reason:'RUN_'+String(current.conclusion||'UNFINISHED').toUpperCase().slice(0,30)};
   continue;
  }
  const jobs=jobsByRun[String(current.id)];
  if(!Array.isArray(jobs)){
   channels[key]={...result,status:'PENDING',reason:'JOBS_NOT_FETCHED'};
   continue;
  }
  const details={};
  let incomplete=false,bad=false;
  for(const name of config.jobs){
   const matches=jobs.filter(j=>j&&j.name===name);
   const job=matches.sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0))[0];
   details[name]=job?.conclusion||'missing';
   if(!job||job.status!=='completed'){incomplete=true;continue;}
   if(job.conclusion!=='success')bad=true;
  }
  channels[key]={...result,status:bad?'FAIL':incomplete?'PENDING':'PASS',
   reason:bad?'REQUIRED_JOB_NOT_SUCCESS':incomplete?'REQUIRED_JOB_MISSING':'ALL_REQUIRED_JOBS_PASS',
   jobs:details};
 }
 const currentMain=sourceSha===mainSha;
 const statuses=Object.values(channels).map(x=>x.status);
 const status=!currentMain?'SUPERSEDED':
  statuses.includes('FAIL')?'FAIL':
  statuses.every(x=>x==='PASS')?'PASS':'PENDING';
 return {
  format:'MARCOSA-R114-DUAL-RELEASE-EVIDENCE-v1',sourceSha,mainSha,currentMain,
  status,channels,
  sourceBasedPublicPagesVerified:channels.pages.status==='PASS',
  sourceBasedRestrictedStagingVerified:channels.staging.status==='PASS',
  publicWebsite:'https://osmanosmanov6880-bot.github.io/marcosa-fusion/',
  productionDomain:'https://marcosa.club/',
  productionAuthorized:false,
  productionCutoverVerified:false,
  privateAccountsOrDatabaseVerified:false,
  description:'PASS proves same SHA served by verified public GitHub Pages and delivered to restricted SSH staging. It does NOT authorize production.'
 };
}

async function getJson(url,token){
 assert(url.startsWith(root+'/repos/'+REPO+'/'),'Only fixed first-party GitHub API allowed');
 const response=await fetch(url,{method:'GET',redirect:'error',
  headers:{Accept:'application/vnd.github+json','Authorization':'Bearer '+token,
   'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Read-only GitHub API '+response.status);
 const body=await response.text();
 assert(body.length<2*1024*1024,'GitHub response larger than evidence bound');
 return JSON.parse(body);
}
async function inspect(sourceSha,token){
 assert(SHA.test(sourceSha||''),'Exact source SHA required');
 assert(token&&typeof token==='string'&&token.length>10,'Read-only GitHub token required');
 const ref=await getJson(root+'/repos/'+REPO+'/git/ref/heads/main',token);
 const mainSha=ref?.object?.sha;
 assert(SHA.test(mainSha||''),'Unable to verify real main SHA');
 const snapshots=await Promise.all(Object.values(PIPELINES).map(async x=>{
  const url=root+'/repos/'+REPO+'/actions/workflows/'+x.file+'/runs?per_page=60';
  const out=await getJson(url,token);
  assert(Array.isArray(out.workflow_runs),'Expected bounded Actions run listing');
  return out.workflow_runs.slice(0,60);
 }));
 const runs=snapshots.flat().filter(x=>x.head_sha===sourceSha);
 const jobsByRun={};
 for(const run of runs.filter(x=>x.status==='completed'&&x.conclusion==='success')){
  assert(ID.test(String(run.id)),'Invalid approved run ID');
  const url=root+'/repos/'+REPO+'/actions/runs/'+run.id+'/jobs?per_page=100';
  const jobs=await getJson(url,token);
  assert(Array.isArray(jobs.jobs),'Expected Actions jobs listing');
  jobsByRun[String(run.id)]=jobs.jobs;
 }
 return evaluateRelease({sourceSha,mainSha,runs,jobsByRun});
}
async function main(){
 if(process.env.GITHUB_REPOSITORY!==REPO)throw Error('Wrong repository: audit blocked');
 const sha=process.env.RELEASE_SHA,token=process.env.GITHUB_TOKEN;
 const result=await inspect(sha,token);
 writeFileSync('marcosa-r114-release-evidence.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('MARCOSA_DUAL_CHANNEL_EVIDENCE='+result.status);
 console.log('PUBLIC_PAGES_SHA_VERIFIED='+String(result.sourceBasedPublicPagesVerified).toUpperCase());
 console.log('RESTRICTED_STAGING_SHA_VERIFIED='+String(result.sourceBasedRestrictedStagingVerified).toUpperCase());
 console.log('PRODUCTION_CUTOVER_AUTHORIZED=NO');
 const lines=['### MARCOSA R114 — evidence for exact Git commit',
  '- Source SHA: '+result.sourceSha,
  '- Current main: '+String(result.currentMain),
  '- Public GitHub Pages with all required jobs: '+result.channels.pages.status,
  '- Restricted Contabo STAGING with all required jobs: '+result.channels.staging.status,
  '- Dual-channel evidence: **'+result.status+'**',
  '- Current marcosa.club production cutover: **NOT AUTHORIZED**',
  '- This report does not verify user accounts, Supabase or private databases.',
  ''];
 if(process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}catch(error){
  console.error('R114_EVIDENCE_FAILED='+String(error.message||error).slice(0,150));
  process.exitCode=2;
 }
}
