/**
 * R186: actionable real READ-ONLY GitHub preflight. GET-only GitHub REST;
 * no review submission, environment edits, deployment or token disclosure.
 * Captures observed facts, NOT independent human identity attestation.
 * CI injects synthetic responses and explicitly records that provenance.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R186 GitHub preflight: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const H40=/^[a-f0-9]{40}$/;
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='feature/marcosa-r150-growth-economics';
const BASE='feature/series-pilot-r149';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const time=x=>typeof x==='string'?Date.parse(x):NaN;
const uid=x=>Number.isSafeInteger(x)&&x>0;
const scopeMode=x=>['CI_SYNTHETIC','OPERATOR_READONLY_UNATTESTED'].includes(x);
export function createR186GithubPreflight({
 fetcher=globalThis.fetch,token,clock=()=>Date.now(),
 allowNetwork=false,sourceMode='CI_SYNTHETIC'
}={}){
 ok(typeof fetcher==='function'&&typeof clock==='function'&&
  scopeMode(sourceMode),'bounded GitHub fetcher and provenance required');
 const root='https://api.github.com/repos/'+REPO;
 async function get(path,{notFound=false}={}){
  ok(allowNetwork===true&&typeof token==='string'&&
   /^[A-Za-z0-9._-]{12,4096}$/.test(token),
   'manual read-only API token and explicit network opt-in required');
  let r;
  try{r=await fetcher(root+path,{
   method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(10000),
   headers:{Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2026-03-10',
    'User-Agent':'marcosa-r186-staging-readonly'}
  });}catch{fail('read-only GitHub request failed');}
  if(notFound&&r?.status===404)return null;
  ok(r?.status===200&&/json/i.test(r.headers?.get?.('content-type')||''),
   'GitHub API unavailable, unauthorized or wrong response type');
  let raw;
  try{raw=await r.text();}catch{fail('GitHub provider response truncated');}
  ok(typeof raw==='string'&&raw.length>=2&&raw.length<=225000,
   'GitHub response outside bounded JSON size');
  try{return JSON.parse(raw);}catch{fail('GitHub returned invalid JSON');}
 }
 async function inspect({commit,bundleSha256}={}){
  ok(H40.test(commit||'')&&/^[a-f0-9]{64}$/.test(bundleSha256||''),
   'full HEAD and source bundle pins required');
  const [pr,commitResponse,environment]=await Promise.all([
   get('/pulls/168'),get('/commits/'+commit),
   get('/environments/marcosa-aws-staging',{notFound:true})
  ]);
  const now=clock(),committed=time(commitResponse?.commit?.committer?.date);
  ok(Number.isSafeInteger(now)&&now>=0&&
   pr?.number===168&&pr?.state==='open'&&pr.head?.sha===commit&&
   pr.head?.ref===BRANCH&&pr.head?.repo?.full_name===REPO&&
   pr.base?.ref===BASE&&pr.base?.repo?.full_name===REPO&&
   uid(pr.user?.id)&&
   commitResponse?.sha===commit&&
   Number.isSafeInteger(committed)&&committed<=now,
   'PR 168 source/base/head drift, unsigned origin time or missing author');
  const verifiedSignedCommit=commitResponse.commit?.verification?.verified===true;
  let reviews=[],complete=false,pages=0;
  for(let page=1;page<=4;page++){
   const result=await get('/pulls/168/reviews?per_page=100&page='+page);
   ok(Array.isArray(result)&&result.length<=100,
    'incomplete or oversized PR review history page');
   reviews.push(...result);pages++;
   if(result.length<100){complete=true;break;}
  }
  ok(complete&&reviews.length<=400,'PR review pagination exceeds four pages');
  const last=new Map(),seen=new Set();
  let rejectedReviewRows=0;
  for(const review of reviews){
   ok(uid(review?.id)&&uid(review?.user?.id)&&
    review.user?.type==='User'&&!seen.has(review.id)&&
    ['APPROVED','CHANGES_REQUESTED','DISMISSED','COMMENTED',
     'PENDING'].includes(review.state),
    'untrusted reviewer identity or duplicated review');
   seen.add(review.id);
   if(review.commit_id!==commit)continue;
   const at=time(review.submitted_at);
   if(review.state==='PENDING'){rejectedReviewRows++;continue;}
   ok(Number.isSafeInteger(at)&&at>=committed&&at<=now,
    'review on current commit missing valid timestamp');
   const older=last.get(review.user.id);
   if(!older||at>older.at||(at===older.at&&review.id>older.id))
    last.set(review.user.id,{id:review.id,at,state:review.state});
  }
  const approvals=[...last.entries()].filter(([id,x])=>
   id!==pr.user.id&&x.state==='APPROVED');
  const requested=[...last.values()].filter(x=>x.state==='CHANGES_REQUESTED');
  const rules=environment?.protection_rules;
  const envHasManualReview=Array.isArray(rules)&&rules.some(x=>
   x?.type==='required_reviewers'&&Array.isArray(x.reviewers)&&
   x.reviewers.length>=2);
  const environmentConfigured=environment?.name==='marcosa-aws-staging'&&
   Array.isArray(rules);
  const evidence={
   schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
   sourceMode,repository:REPO,pullRequest:168,
   headMatchesReviewedCheckout:true,verifiedSignedCommit,
   observedPrReviewEvents:reviews.length,
   reviewedPages:pages,historyComplete:true,
   currentHeadUniqueApprovals:approvals.length,
   currentHeadUnresolvedChanges:requested.length,
   ignoredPendingReviews:rejectedReviewRows,
   githubEnvironmentConfigured:environmentConfigured,
   environmentReviewProtectionConfigured:envHasManualReview,
   configuredEnvironmentName:'marcosa-aws-staging',
   readyForIndependentHumanReview:verifiedSignedCommit&&
    approvals.length>=2&&requested.length===0&&envHasManualReview,
   realHumanIdentityIndependentlyAttested:false,
   realGitHubDeploymentAuthorizationVerified:false,
   actualDeploymentAttempted:false,
   observedAtMs:now,expiresAtMs:now+60000,
   realPilotAuthorized:false,productionAuthorized:false
  };
  return Object.freeze({...evidence,evidenceSha256:sha(evidence)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowNetwork,readOnly:true,sourceMode,
  productionAuthorized:false})});
}
