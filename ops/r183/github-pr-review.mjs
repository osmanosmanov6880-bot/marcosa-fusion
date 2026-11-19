/**
 * R183 independent PR-code-review inspection; deployment environment
 * reviewers (R181) and PR reviewers are different control surfaces.
 * Require TWO completed PR approvals of the exact head SHA, a verified
 * GitHub commit signature, and no conflicting CHANGES_REQUESTED.
 * CI fetch injection is simulated; this NEVER proves real human identity.
 */
import {createHash} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const PR=168,BRANCH='feature/marcosa-r150-growth-economics';
const BASE='feature/series-pilot-r149';
const H40=/^[a-f0-9]{40}$/;
const fail=m=>{throw Error('R183 GitHub PR review: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const uid=n=>Number.isSafeInteger(n)&&n>0;
const parseTime=v=>typeof v==='string'?Date.parse(v):NaN;
export function createR183PrReviewAudit({fetcher=globalThis.fetch,
 token,reviewerIds,commit,clock=()=>Date.now(),
 allowNetwork=false}={}){
 ok(typeof fetcher==='function'&&H40.test(commit||'')&&
  Array.isArray(reviewerIds)&&reviewerIds.length>=2&&
  reviewerIds.length<=6&&reviewerIds.every(uid)&&
  new Set(reviewerIds).size===reviewerIds.length&&
  typeof clock==='function','two distinct expected PR reviewers and immutable SHA required');
 async function request(path){
  ok(allowNetwork===true&&typeof token==='string'&&
   token.length>=12&&token.length<=4096&&
   /^[A-Za-z0-9._-]+$/.test(token),
   'GitHub PR read-only API disabled or token invalid');
  let response;
  try{response=await fetcher('https://api.github.com/repos/'+REPO+path,{
   method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(8000),
   headers:{Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2026-03-10',
    'User-Agent':'marcosa-r183-readonly-pr-review'}
  });}catch{fail('GitHub protected PR read-only request unavailable');}
  ok(response?.status===200&&
   /json/i.test(response.headers?.get?.('content-type')||''),
   'GitHub PR permission error, non-200 or non-JSON response');
  let body;
  try{body=await response.text();}catch{fail('GitHub response unreadable');}
  ok(typeof body==='string'&&body.length>=2&&body.length<160000,
   'bounded completed GitHub PR review evidence required');
  try{return JSON.parse(body);}catch{fail('invalid GitHub PR JSON');}
 }
 async function inspect(){
  const [pr,reviews,source]=await Promise.all([
   request('/pulls/'+PR),
   request('/pulls/'+PR+'/reviews?per_page=100&page=1'),
   request('/commits/'+commit)
  ]);
  ok(pr?.number===PR&&pr.state==='open'&&pr.draft===false&&
   pr.head?.sha===commit&&pr.head?.ref===BRANCH&&
   pr.head?.repo?.full_name===REPO&&
   pr.base?.ref===BASE&&pr.base?.repo?.full_name===REPO&&
   uid(pr.user?.id)&&pr.user?.type==='User'&&
   !reviewerIds.includes(pr.user.id),
   'PR source, base, state, author separation or immutable SHA changed');
  const now=clock(),commitAt=parseTime(source?.commit?.committer?.date);
  ok(source?.sha===commit&&
   source.commit?.verification?.verified===true&&
   Number.isSafeInteger(now)&&Number.isSafeInteger(commitAt)&&
   now>=commitAt&&now-commitAt<=14*86400000,
   'exact head commit must have verified GitHub signature and recent timestamp');
  ok(Array.isArray(reviews)&&reviews.length>=2&&reviews.length<100,
   'complete first page of review-history with no unexamined pagination required');
  // Latest review per user is authoritative: earlier approval cannot mask a
  // later rejection or dismissal on the same head.
  const byUser=new Map();
  for(const r of reviews){
   ok(uid(r?.id)&&uid(r.user?.id)&&r.user?.type==='User'&&
    typeof r.state==='string'&&
    ['APPROVED','CHANGES_REQUESTED','DISMISSED','COMMENTED','PENDING'].includes(r.state),
    'untrusted review state, bot or incomplete identity');
   if(r.commit_id!==commit)continue;
   const at=parseTime(r.submitted_at);
   ok(Number.isSafeInteger(at)&&at>=commitAt&&at<=now,
    'review on current commit is undated or predates commit');
   const prior=byUser.get(r.user.id);
   if(!prior||at>prior.at||(at===prior.at&&r.id>prior.id))
    byUser.set(r.user.id,{id:r.id,at,state:r.state});
  }
  const selected=[];
  for(const id of reviewerIds){
   const x=byUser.get(id);
   ok(x?.state==='APPROVED'&&id!==pr.user.id,
    'each expected reviewer must have an actual final approval on HEAD');
   selected.push({reviewerId:id,reviewId:x.id,submittedAtMs:x.at});
  }
  ok(selected.length>=2&&
   [...byUser.values()].every(x=>x.state!=='CHANGES_REQUESTED'),
   'changes requested on head after approval blocks staging');
  selected.sort((a,b)=>a.reviewerId-b.reviewerId);
  const record={
   schemaVersion:1,commit,pullRequest:PR,branch:BRANCH,base:BASE,
   verifiedCommitSignatureObserved:true,
   exactTwoHeadPrReviewEventsObserved:true,
   reviewers:selected,checkedAtMs:now,expiresAtMs:now+60000,
   independentNaturalHumanIdentityVerified:false,
   realGitHubProviderIndependentlyAttested:false,
   approvedToDeploy:false,productionAuthorized:false
  };
  return Object.freeze({...record,evidenceSha256:digest(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,networkEnabled:allowNetwork,productionAuthorized:false})});
}
