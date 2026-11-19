/**
 * R172 read-only GitHub REST environment and workflow verification.
 * A GitHub Actions environment label alone provides NO security proof:
 * absent environments can be created without protection. This audit refuses
 * missing, weak, wildcard or self-reviewable environment protection.
 *
 * GET only; no GitHub configuration changes or OIDC token issuance.
 */
import {createHash} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='feature/marcosa-r150-growth-economics';
const ENV='marcosa-aws-staging';
const WORKFLOW='marcosa-r171-live-staging.yml';
const fail=m=>{throw Error('R172 GitHub environment: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>Number.isSafeInteger(x)&&x>0;
export function createR172GitHubEnvironmentAudit({
 fetcher=globalThis.fetch,env=process.env,clock=()=>Date.now(),
 allowExternalCalls=false
}={}){
 ok(typeof fetcher==='function'&&typeof clock==='function',
  'inject protected GitHub read-only HTTP client');
 async function get(path,token){
  ok(allowExternalCalls===true,'GitHub API network is disabled');
  const url='https://api.github.com/repos/'+REPO+'/'+path;
  let response;
  try{
   response=await fetcher(url,{method:'GET',redirect:'error',
    cache:'no-store',signal:AbortSignal.timeout(7000),headers:{
     Authorization:'Bearer '+token,
     Accept:'application/vnd.github+json',
     'X-GitHub-Api-Version':'2026-03-10',
     'User-Agent':'marcosa-staging-gate-r172'
    }});
  }catch{fail('GitHub API HTTPS request failed');}
  ok(response?.status===200&&
   String(response.headers?.get?.('content-type')||'').includes('application/json'),
   'GitHub API status/type denied (missing Administration read?)');
  let body;
  try{body=await response.text();}catch{fail('GitHub API body unavailable');}
  ok(typeof body==='string'&&body.length>10&&body.length<=120000,
   'bounded GitHub JSON required');
  let parsed;
  try{parsed=JSON.parse(body);}catch{fail('GitHub JSON malformed');}
  ok(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),
   'unexpected GitHub API response');
  return parsed;
 }
 async function inspect(){
  const token=env.MARCOSA_GITHUB_ENV_AUDIT_TOKEN;
  ok(allowExternalCalls===true&&typeof token==='string'&&
   token.length>=20&&token.length<=4096&&
   /^[A-Za-z0-9._-]+$/.test(token),
   'explicit read-only GitHub environment audit token required');
  ok(env.GITHUB_ACTIONS==='true'&&
   env.GITHUB_REPOSITORY===REPO&&
   env.GITHUB_REF==='refs/heads/'+BRANCH&&
   env.GITHUB_EVENT_NAME==='workflow_dispatch'&&
   env.GITHUB_RUN_ATTEMPT==='1'&&
   /^[0-9]{5,20}$/.test(env.GITHUB_RUN_ID||'')&&
   /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
   env.GITHUB_REPOSITORY_ID==='1430301644'&&
   env.GITHUB_REPOSITORY_OWNER_ID==='340648536',
   'only exact manual feature-branch run may inspect environment');
  const [environment,policies,run]=await Promise.all([
   get('environments/'+ENV,token),
   get('environments/'+ENV+'/deployment-branch-policies?per_page=100',token),
   get('actions/runs/'+env.GITHUB_RUN_ID,token)
  ]);
  ok(environment.name===ENV&&validId(environment.id)&&
   environment.deployment_branch_policy?.custom_branch_policies===true&&
   environment.deployment_branch_policy.protected_branches===false,
   'environment branch restriction missing');
  const rules=environment.protection_rules;
  ok(Array.isArray(rules)&&rules.length>=2&&rules.length<=8,
   'GitHub environment must have actual protection rules');
  const required=rules.filter(x=>x.type==='required_reviewers');
  const branchRule=rules.filter(x=>x.type==='branch_policy');
  ok(required.length===1&&branchRule.length===1&&
   required[0].prevent_self_review===true,
   'independent review and branch policy not enforced');
  const reviewers=required[0].reviewers;
  ok(Array.isArray(reviewers)&&reviewers.length>=2&&reviewers.length<=6&&
   reviewers.every(x=>x.type==='User'&&validId(x.reviewer?.id))&&
   new Set(reviewers.map(x=>x.reviewer.id)).size===reviewers.length,
   'at least two distinct approved user identities required');
  ok(policies.total_count===1&&
   Array.isArray(policies.branch_policies)&&policies.branch_policies.length===1&&
   policies.branch_policies[0].name===BRANCH,
   'GitHub custom deployment branches must be exactly one literal feature branch');
  ok(run.event==='workflow_dispatch'&&
   run.head_branch===BRANCH&&run.head_sha===env.GITHUB_SHA&&
   run.run_attempt===1&&
   run.repository?.full_name===REPO&&run.repository?.id===1430301644&&
   run.repository.owner?.id===340648536&&
   run.head_repository?.id===1430301644&&
   validId(run.actor?.id)&&
   !reviewers.some(x=>x.reviewer.id===run.actor.id)&&
   run.path?.startsWith('.github/workflows/'+WORKFLOW+'@')&&
   (run.status==='in_progress'||run.status==='queued'),
   'run context, SHA, fork, actor or workflow path inconsistent');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'clock unavailable');
  return Object.freeze({
   verified:true,repository:REPO,ref:'refs/heads/'+BRANCH,
   commit:env.GITHUB_SHA,environmentId:environment.id,
   workflowPath:WORKFLOW,reviewerCount:reviewers.length,
   environmentReviewerFingerprint:digest(reviewers.map(x=>x.reviewer.id).sort()),
   branchPolicyExactlyPinned:true,preventSelfReview:true,
   runActorIndependentOfConfiguredReviewers:true,
   checkedAtMs:now,expiresAtMs:now+60000,
   twoActualHumanApprovalsVerified:false,
   environmentDeploymentApprovalEventVerified:false,
   productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  readOnly:true,networkEnabled:allowExternalCalls,
  requiresAdminReadOnlyPermission:true,productionAuthorized:false
 })});
}
export function verifyR172GitHubEnvironmentAudit(proof,{commit,clock=()=>Date.now()}={}){
 const now=clock();
 ok(proof?.verified===true&&proof.repository===REPO&&
  proof.ref==='refs/heads/'+BRANCH&&proof.commit===commit&&
  validId(proof.environmentId)&&
  proof.workflowPath===WORKFLOW&&proof.reviewerCount>=2&&
  proof.branchPolicyExactlyPinned===true&&
  proof.preventSelfReview===true&&
  proof.runActorIndependentOfConfiguredReviewers===true&&
  proof.twoActualHumanApprovalsVerified===false&&
  proof.environmentDeploymentApprovalEventVerified===false&&
  proof.productionAuthorized===false&&
  now>=proof.checkedAtMs&&now<=proof.expiresAtMs&&
  proof.expiresAtMs-proof.checkedAtMs<=60000,
  'GitHub environment proof stale or wrongly elevated');
 return Object.freeze({readOnlyEnvironmentVerified:true,
  actualApprovalEvidenceStillRequired:true,productionAuthorized:false});
}
