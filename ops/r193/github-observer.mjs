/**
 * R193 bounded read-only GitHub observer for exact PR #168, head SHA, reviews
 * and latest CI workflow run. An API response is not independent human proof.
 * No submission, deployment, comments, secrets or write methods.
 */
import {H40,H64,requireTrue,sealReceipt} from '../r190/common.mjs';
const ROOT='https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion';
const PR=168,BRANCH='feature/marcosa-r150-growth-economics';
const BASE='feature/series-pilot-r149';
const roleNames=['SECURITY','OPERATIONS','PRIVACY'];
const isId=x=>Number.isSafeInteger(x)&&x>0;
const when=x=>typeof x==='string'?Date.parse(x):NaN;
export async function observeR193Github({
 commit,bundleSha256,reviewerIds,runId,
 fetchImpl=globalThis.fetch,token,
 allowNetwork=false,sourceMode='CI_FIXTURE',clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  isId(runId)&&typeof fetchImpl==='function'&&typeof clock==='function'&&
  ['CI_FIXTURE','OPERATOR_READONLY_UNATTESTED'].includes(sourceMode)&&
  allowNetwork===true,'R193 exact source and opt-in read-only GitHub required');
 requireTrue(reviewerIds&&Object.getPrototypeOf(reviewerIds)===Object.prototype&&
  Object.keys(reviewerIds).sort().join(',')===roleNames.slice().sort().join(',')&&
  roleNames.every(role=>isId(reviewerIds[role]))&&
  new Set(roleNames.map(role=>reviewerIds[role])).size===3,
  'three distinct explicit reviewer numeric GitHub IDs required');
 if(sourceMode==='CI_FIXTURE')
  requireTrue(token===undefined,'fixture must have no GitHub token');
 else requireTrue(token===undefined||
  (typeof token==='string'&&/^[A-Za-z0-9._-]{12,4096}$/.test(token)),
  'bounded read-only API token required if supplied');
 const prUrl=ROOT+'/pulls/'+PR;
 const commitUrl=ROOT+'/commits/'+commit;
 const runUrl=ROOT+'/actions/runs/'+runId;
 const reviewPrefix=prUrl+'/reviews?per_page=100&page=';
 async function request(url){
  const page=url.startsWith(reviewPrefix)?url.slice(reviewPrefix.length):null;
  requireTrue(url===prUrl||url===commitUrl||url===runUrl||
   (page!==null&&/^(?:[1-9]|10)$/.test(page)),
   'unapproved GitHub endpoint forbidden');
  const headers={Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28',
   'User-Agent':'marcosa-r193-readonly'};
  if(token)headers.Authorization='Bearer '+token;
  let response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',
   headers,signal:AbortSignal.timeout(7000)});}
  catch{throw Error('R193 GitHub: read unavailable');}
  requireTrue(response?.status===200&&response.redirected!==true&&
   (typeof response.url!=='string'||response.url===url)&&
   /json/i.test(response.headers?.get?.('content-type')||''),
   'R193 GitHub: unexpected status, redirect or response type');
  const raw=await response.text();
  requireTrue(typeof raw==='string'&&raw.length>=2&&raw.length<=1000000,
   'R193 GitHub: response size exceeded');
  try{return JSON.parse(raw);}catch{throw Error('R193 GitHub: invalid JSON');}
 }
 const started=clock();
 requireTrue(Number.isSafeInteger(started)&&started>0,'source timestamp required');
 const p=await request(prUrl);
 function verifyPR(meta){
  requireTrue(meta?.number===PR&&meta.state==='open'&&meta.draft===false&&
   meta.head?.sha===commit&&meta.head?.ref===BRANCH&&
   meta.head?.repo?.full_name==='osmanosmanov6880-bot/marcosa-fusion'&&
   meta.base?.ref===BASE&&
   meta.base?.repo?.full_name==='osmanosmanov6880-bot/marcosa-fusion'&&
   isId(meta.user?.id)&&meta.user?.type==='User',
   'R193 GitHub: exact head/base, PR state or author drift');
 }
 verifyPR(p);
 requireTrue(!Object.values(reviewerIds).includes(p.user.id),
  'R193 GitHub: PR author cannot self-approve');
 const [headCommit,run]=await Promise.all([
  request(commitUrl),request(runUrl)
 ]);
 requireTrue(headCommit?.sha===commit&&
  typeof headCommit.commit?.verification?.verified==='boolean',
  'R193 GitHub: head commit signature claim absent');
 const startedRun=when(run?.created_at);
 requireTrue(run?.id===runId&&run?.head_sha===commit&&
  run?.head_branch===BRANCH&&
  run?.repository?.full_name==='osmanosmanov6880-bot/marcosa-fusion'&&
  Number.isFinite(startedRun)&&startedRun<=started,
  'R193 GitHub: CI run not bound to reviewed source');
 const events=[],seen=new Set();
 for(let page=1;page<=10;page++){
  const result=await request(reviewPrefix+page);
  requireTrue(Array.isArray(result)&&result.length<=100,'R193 GitHub: incomplete review page');
  for(const event of result){
   requireTrue(isId(event?.id)&&!seen.has(event.id)&&
    isId(event.user?.id)&&['User','Bot'].includes(event.user.type)&&
    ['APPROVED','CHANGES_REQUESTED','COMMENTED','DISMISSED','PENDING'].includes(event.state)&&
    (event.commit_id===null||H40.test(event.commit_id||'')),
    'R193 GitHub: forged or duplicate review');
   seen.add(event.id);
   const at=when(event.submitted_at);
   if(event.state!=='PENDING')
    requireTrue(Number.isFinite(at)&&at>0&&at<=started,
     'R193 GitHub: invalid review chronology');
   events.push({id:event.id,userId:event.user.id,
    roleType:event.user.type,state:event.state,
    commit:event.commit_id,submittedMs:Number.isFinite(at)?at:null});
  }
  if(result.length<100)break;
  requireTrue(page<10,'R193 GitHub: review pagination overflow');
 }
 const latest=new Map();
 for(const e of events){
  const prev=latest.get(e.userId);
  if(!prev||(e.submittedMs??-1)>(prev.submittedMs??-1)||
   ((e.submittedMs??-1)===(prev.submittedMs??-1)&&e.id>prev.id))
   latest.set(e.userId,e);
 }
 const approvalChecks=roleNames.map(role=>{
  const id=reviewerIds[role],e=latest.get(id);
  return {role,githubUserId:id,
   approved:!!e&&e.roleType==='User'&&
    e.state==='APPROVED'&&e.commit===commit,
   latestState:e?.state||'MISSING'};
 });
 const blockers=[];
 const unresolved=[...latest.values()].some(e=>
  e.state==='CHANGES_REQUESTED'&&e.commit===commit);
 if(unresolved)blockers.push('UNRESOLVED_CHANGES_REQUESTED');
 for(const row of approvalChecks)if(!row.approved)
  blockers.push('MISSING_'+row.role+'_REVIEW');
 const signed=headCommit.commit.verification.verified===true;
 if(!signed)blockers.push('HEAD_COMMIT_SIGNATURE_NOT_VERIFIED');
 if(run.status!=='completed'||run.conclusion!=='success')
  blockers.push('TARGET_CI_RUN_NOT_SUCCESS');
 const after=await request(prUrl);verifyPR(after);
 requireTrue(after.user.id===p.user.id,'R193 GitHub: author changed during read');
 const end=clock();
 requireTrue(Number.isSafeInteger(end)&&end>=started&&end-started<=30000,
  'R193 GitHub: read window expired');
 return sealReceipt({schemaVersion:1,kind:'R193_GITHUB',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode,repository:'osmanosmanov6880-bot/marcosa-fusion',
  pullRequest:168,reviewedRunId:runId,
  runStatus:run.status,runConclusion:run.conclusion,
  prHeadMatches:true,prAuthorId:p.user.id,
  observedReviewEvents:events.length,historyComplete:true,
  reviewers:approvalChecks,unresolvedChangesRequested:unresolved,
  commitSignatureProviderClaim:signed,
  allThreeApprovalsObserved:approvalChecks.every(x=>x.approved)&&!unresolved,
  blockers,
  independentGithubProviderVerification:false,
  reviewerNaturalIdentityVerification:false,
  observedAtMs:end,expiresAtMs:end+60000,
  decision:'NO_GO_EXTERNAL_OPERATOR_REVIEW_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
