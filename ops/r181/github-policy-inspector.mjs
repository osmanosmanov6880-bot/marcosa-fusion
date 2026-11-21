/**
 * R181 inspect actual GitHub REST environment, protected branch, run and
 * two DISTINCT completed deployment review events. Read-only GET only.
 * A GitHub required-reviewer rule needs only one approval, so the second
 * approval is verified separately, never inferred from a reviewer list.
 * Injected fetcher in CI is synthetic; provider authenticity not asserted.
 */
import {createHash} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='feature/marcosa-r150-growth-economics';
const ENV='marcosa-aws-staging';
const H40=/^[a-f0-9]{40}$/;
const fail=m=>{throw Error('R181 GitHub policy: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const id=x=>Number.isSafeInteger(x)&&x>0;
const at=x=>typeof x==='string'?Date.parse(x):NaN;
export function createR181GithubPolicyInspector({
 fetcher=globalThis.fetch,token,runId,commit,actorId,
 reviewerIds,clock=()=>Date.now(),allowNetwork=false
}={}){
 ok(typeof fetcher==='function'&&
  Number.isSafeInteger(runId)&&runId>=10000&&H40.test(commit||'')&&
  id(actorId)&&Array.isArray(reviewerIds)&&reviewerIds.length>=2&&
  reviewerIds.length<=6&&reviewerIds.every(id)&&
  new Set(reviewerIds).size===reviewerIds.length&&
  !reviewerIds.includes(actorId)&&typeof clock==='function',
  'fixed repository, run SHA, initiator and two separate reviewer IDs required');
 const root='https://api.github.com/repos/'+REPO;
 async function request(suffix){
  ok(allowNetwork===true&&
   typeof token==='string'&&token.length>=12&&token.length<=4096&&
   /^[A-Za-z0-9._-]+$/.test(token),
   'GitHub read-only network explicitly disabled or token not provided');
  let response;
  try{
   response=await fetcher(root+suffix,{
    method:'GET',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+token,
     Accept:'application/vnd.github+json',
     'X-GitHub-Api-Version':'2026-03-10',
     'User-Agent':'marcosa-r181-readonly-policy'}
   });
  }catch{fail('GitHub REST unavailable; permission denied or network failure');}
  ok(response?.status===200&&
   /json/i.test(response.headers?.get?.('content-type')||''),
   'GitHub REST 200 JSON required; forbidden/404 is NO-GO');
  let body;
  try{body=await response.text();}catch{fail('GitHub JSON response unreadable');}
  ok(typeof body==='string'&&body.length>=2&&body.length<150000,
   'bounded environment and review evidence required');
  try{return JSON.parse(body);}catch{fail('GitHub response is not valid JSON');}
 }
 async function inspect(){
  const branch=encodeURIComponent(BRANCH);
  const [env,protection,run,approvals]=await Promise.all([
   request('/environments/'+ENV),
   request('/branches/'+branch+'/protection'),
   request('/actions/runs/'+runId),
   request('/actions/runs/'+runId+'/approvals')
  ]);
  ok(env?.name===ENV&&id(env.id)&&Array.isArray(env.protection_rules)&&
   env.protection_rules.length>=2&&
   env.deployment_branch_policy?.protected_branches===true&&
   env.deployment_branch_policy?.custom_branch_policies===false,
   'staging environment, protected-branch deployment policy or rules missing');
  const rule=env.protection_rules.filter(x=>x.type==='required_reviewers');
  ok(rule.length===1&&rule[0].prevent_self_review===true&&
   Array.isArray(rule[0].reviewers)&&rule[0].reviewers.length>=2&&
   rule[0].reviewers.length<=6,
   'GitHub required reviewers, prevent_self_review and individual Users required');
  const configured=rule[0].reviewers.map(x=>{
   ok(x.type==='User'&&id(x.reviewer?.id)&&x.reviewer?.type==='User',
    'reject teams or unidentifiable reviewer entries for dual-human check');
   return x.reviewer.id;
  });
  ok(new Set(configured).size===configured.length&&
   reviewerIds.every(x=>configured.includes(x)),
   'two independently expected reviewers must be explicitly configured');
  ok(protection&&
   protection.required_status_checks?.strict===true&&
   protection.enforce_admins?.enabled===true&&
   protection.required_pull_request_reviews?.dismiss_stale_reviews===true&&
   protection.required_pull_request_reviews?.required_approving_review_count>=2&&
   protection.allow_force_pushes?.enabled!==true&&
   protection.allow_deletions?.enabled!==true,
   'strict branch protection, two PR reviews and no admin/force-push bypass required');
  const started=at(run?.run_started_at||run?.created_at),now=clock();
  ok(id(run?.id)&&run.id===runId&&run.head_sha===commit&&
   run.head_branch===BRANCH&&run.event==='workflow_dispatch'&&
   run.run_attempt===1&&run.actor?.id===actorId&&
   run.actor?.type==='User'&&
   run.repository?.full_name===REPO&&run.head_repository?.full_name===REPO&&
   run.path?.startsWith('.github/workflows/marcosa-r181-')&&
   Number.isSafeInteger(started)&&Number.isSafeInteger(now)&&
   started<=now&&now-started<=86400000,
   'manual run provenance, actor, exact branch/commit or freshness invalid');
  ok(Array.isArray(approvals)&&approvals.length>=2&&approvals.length<=40,
   'GitHub deployment approval history required');
  const seen=new Set(),approved=[];
  for(const e of approvals){
   const scoped=e?.environments?.filter(x=>x.name===ENV)||[];
   if(!scoped.length)continue;
   ok(scoped.length===1&&e.state==='approved'&&id(e.user?.id)&&
    e.user?.type==='User'&&e.user.id!==actorId&&
    reviewerIds.includes(e.user.id)&&configured.includes(e.user.id)&&
    !seen.has(e.user.id)&&scoped[0].id===env.id,
    'rejected, self-approved, duplicated or unconfigured GitHub event');
   const time=at(scoped[0].updated_at||scoped[0].created_at);
   ok(Number.isSafeInteger(time)&&time>=started&&time<=now,
    'deployment review event outside exact workflow time window');
   seen.add(e.user.id);
   approved.push({userId:e.user.id,reviewedAtMs:time});
  }
  ok(approved.length>=2&&reviewerIds.every(x=>seen.has(x)),
   'two real approval EVENT records required, not simply two configured reviewers');
  approved.sort((a,b)=>a.userId-b.userId);
  const data={schemaVersion:1,commit,runId,actorId,branch:BRANCH,
   environment:ENV,environmentId:env.id,reviewers:approved,
   exactProtectedBranchInspected:true,preventSelfReviewConfigured:true,
   twoDistinctReviewEventsShapeMatched:true,
   checkedAtMs:now,expiresAtMs:now+60000,
   providerIdentityIndependentlyAuthenticated:false,
   twoNaturalPersonsIndependentlyVerified:false,
   productionAuthorized:false};
  return Object.freeze({...data,evidenceSha256:hash(data)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,enabled:allowNetwork,productionAuthorized:false})});
}
