/**
 * R179 read-only GitHub Actions run and deployment review-history audit.
 * Queries GitHub REST run + /approvals using a separately supplied token.
 * CI MUST inject a fake fetcher; provider authenticity/human identity are
 * unproven unless a real read-only API connection is independently observed.
 */
import {createHash} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='feature/marcosa-r150-growth-economics';
const ENVIRONMENT='marcosa-aws-staging';
const H40=/^[a-f0-9]{40}$/;
const fail=m=>{throw Error('R179 GitHub approvals: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const uid=x=>Number.isSafeInteger(x)&&x>0;
const epoch=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?
 Date.parse(x):NaN;
export function createR179GithubApprovalAudit({fetcher=globalThis.fetch,
 token,runId,commit,actorId,reviewerIds,clock=()=>Date.now(),
 allowExternalCalls=false}={}){
 ok(typeof fetcher==='function'&&typeof clock==='function'&&
  Number.isSafeInteger(runId)&&runId>=10000&&
  H40.test(commit||'')&&uid(actorId)&&
  Array.isArray(reviewerIds)&&reviewerIds.length>=2&&
  reviewerIds.length<=6&&reviewerIds.every(uid)&&
  new Set(reviewerIds).size===reviewerIds.length&&
  !reviewerIds.includes(actorId),
  'exact run/actor, branch SHA and distinct preapproved reviewers required');
 async function request(path){
  ok(allowExternalCalls===true&&typeof token==='string'&&
   token.length>=12&&token.length<=4096&&
   /^[A-Za-z0-9._-]+$/.test(token),
   'GitHub Actions read-only API disabled without explicit token');
  let response;
  try{response=await fetcher('https://api.github.com/repos/'+REPO+path,{
   method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(8000),headers:{
    Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2026-03-10',
    'User-Agent':'marcosa-r179-staging-approval-audit'
   }});
  }catch{fail('GitHub read-only approval API unavailable');}
  ok(response?.status===200&&
   /json/i.test(response.headers?.get?.('content-type')||''),
   'GitHub review history requires real JSON 200');
  let body;
  try{body=await response.text();}catch{fail('GitHub response body unreadable');}
  ok(typeof body==='string'&&body.length>3&&body.length<120000,
   'bounded GitHub approval JSON required');
  try{return JSON.parse(body);}
  catch{fail('malformed GitHub review-history response');}
 }
 async function inspect(){
  const [run,history]=await Promise.all([
   request('/actions/runs/'+runId),
   request('/actions/runs/'+runId+'/approvals')
  ]);
  const now=clock(),started=epoch(run?.run_started_at||run?.created_at);
  ok(Number.isSafeInteger(now)&&Number.isSafeInteger(started)&&
   now>=started&&now-started<=86400000&&
   run.id===runId&&run.head_sha===commit&&
   run.head_branch===BRANCH&&run.event==='workflow_dispatch'&&
   run.run_attempt===1&&run.actor?.id===actorId&&
   run.actor?.type==='User'&&
   run.repository?.full_name===REPO&&
   run.head_repository?.full_name===REPO&&
   run.path?.startsWith('.github/workflows/marcosa-r179-')&&
   (run.status==='queued'||run.status==='in_progress'||
    run.status==='completed'),
   'run SHA, workflow, source branch, manual action, actor or event replaced');
  ok(Array.isArray(history)&&history.length>=2&&history.length<=40,
   'complete bounded deployment review-history response required');
  const seen=new Set(),approvals=[];
  for(const record of history){
   ok(record&&['approved','rejected','pending'].includes(record.state)&&
    uid(record.user?.id)&&record.user?.type==='User'&&
    Array.isArray(record.environments)&&
    record.environments.length>=1&&record.environments.length<=8,
    'invalid GitHub user, review state or environment');
   const targets=record.environments.filter(e=>e.name===ENVIRONMENT);
   if(!targets.length)continue;
   ok(targets.length===1&&record.user.id!==actorId&&
    reviewerIds.includes(record.user.id)&&
    !seen.has(record.user.id),
    'self review, unapproved reviewer or conflicting subsequent decision');
   seen.add(record.user.id);
   const env=targets[0],at=epoch(env.updated_at||env.created_at);
   ok(uid(env.id)&&Number.isSafeInteger(at)&&
    at>=started&&at<=now&&now-at<=86400000,
    'review event missing actual scoped environment ID or expired');
   ok(record.state==='approved',
    'pending/rejected review overrides synthetic staging consent');
   approvals.push({userId:record.user.id,
    environmentId:env.id,reviewedAtMs:at});
  }
  ok(approvals.length>=2&&
   new Set(approvals.map(x=>x.environmentId)).size===1,
   'at least two distinct successful environment reviewers required');
  approvals.sort((a,b)=>a.userId-b.userId);
  const proof={
   schemaVersion:1,commit,runId,actorId,
   repository:REPO,branch:BRANCH,environment:ENVIRONMENT,
   environmentId:approvals[0].environmentId,
   reviewers:approvals,checkedAtMs:now,expiresAtMs:now+60000,
   githubEventShapeValidated:true,
   independentlyAuthenticatedGitHubApi:false,
   actualHumanIdentityVerified:false,
   productionAuthorized:false
  };
  return Object.freeze({...proof,
   evidenceSha256:digest(proof)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,enabled:allowExternalCalls,
  productionAuthorized:false})});
}
export function verifyR179GithubApprovalProof(p,{commit,runId,actorId,
 clock=()=>Date.now()}={}){
 const {evidenceSha256,...base}=p||{};
 const now=clock();
 ok(p?.schemaVersion===1&&p.commit===commit&&p.runId===runId&&
  p.actorId===actorId&&p.repository===REPO&&p.branch===BRANCH&&
  p.environment===ENVIRONMENT&&uid(p.environmentId)&&
  Array.isArray(p.reviewers)&&p.reviewers.length>=2&&
  p.reviewers.length<=6&&
  p.reviewers.every(r=>uid(r.userId)&&r.userId!==actorId&&
   r.environmentId===p.environmentId&&
   Number.isSafeInteger(r.reviewedAtMs)&&
   r.reviewedAtMs<=p.checkedAtMs)&&
  new Set(p.reviewers.map(r=>r.userId)).size===p.reviewers.length&&
  p.githubEventShapeValidated===true&&
  p.independentlyAuthenticatedGitHubApi===false&&
  p.actualHumanIdentityVerified===false&&
  p.productionAuthorized===false&&
  Number.isSafeInteger(p.checkedAtMs)&&
  now>=p.checkedAtMs&&now<=p.expiresAtMs&&
  p.expiresAtMs-p.checkedAtMs===60000&&
  typeof evidenceSha256==='string'&&
  /^[a-f0-9]{64}$/.test(evidenceSha256)&&
  evidenceSha256===digest(base),
  'GitHub reviewer history altered, stale or falsely elevated');
 return Object.freeze({verified:true,evidenceSha256,
  productionAuthorized:false});
}
