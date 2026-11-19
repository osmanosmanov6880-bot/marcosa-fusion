/**
 * R184 complete 1..4 paginated GitHub REST PR reviews.
 * Unlike R183 first-page-only diagnostics, this inspects ALL review
 * records on HEAD, rejects hidden later CHANGES_REQUESTED and enforces
 * most recent decision per expected reviewer. Read-only GET, no release.
 * Injected fetcher in CI is synthetic; no proof of real people.
 */
import {createHash} from 'node:crypto';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='feature/marcosa-r150-growth-economics';
const BASE='feature/series-pilot-r149';
const H40=/^[a-f0-9]{40}$/;
const fail=m=>{throw Error('R184 paginated PR review: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const id=n=>Number.isSafeInteger(n)&&n>0;
const date=s=>typeof s==='string'?Date.parse(s):NaN;
export function createR184ReviewHistory({
 fetcher=globalThis.fetch,token,commit,
 reviewerIds,clock=()=>Date.now(),allowNetwork=false
}={}){
 ok(typeof fetcher==='function'&&H40.test(commit||'')&&
  Array.isArray(reviewerIds)&&reviewerIds.length>=2&&
  reviewerIds.length<=6&&reviewerIds.every(id)&&
  new Set(reviewerIds).size===reviewerIds.length&&
  typeof clock==='function',
  'exact head SHA and two distinct expected human-account user IDs required');
 const root='https://api.github.com/repos/'+REPO;
 async function get(path){
  ok(allowNetwork===true&&typeof token==='string'&&
   token.length>=12&&token.length<=4096&&
   /^[A-Za-z0-9._-]+$/.test(token),
   'manual read-only GitHub token and enabled network required');
  let response;
  try{response=await fetcher(root+path,{
   method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(10000),
   headers:{Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2026-03-10',
    'User-Agent':'marcosa-r184-paginated-readonly-review'}
  });}catch{fail('GitHub provider unavailable or denied');}
  ok(response?.status===200&&
   /json/i.test(response.headers?.get?.('content-type')||''),
   'GitHub GET 200 JSON required; 403/404 must fail closed');
  let body;
  try{body=await response.text();}catch{fail('provider response truncated');}
  ok(typeof body==='string'&&body.length>=2&&body.length<220000,
   'bounded GitHub PR review page required');
  try{return JSON.parse(body);}catch{fail('non-JSON review history');}
 }
 async function inspect(){
  const [pr,commitDetails]=await Promise.all([
   get('/pulls/168'),get('/commits/'+commit)]);
  const now=clock();
  const committed=date(commitDetails?.commit?.committer?.date);
  ok(pr?.number===168&&pr.state==='open'&&pr.draft===false&&
   pr.head?.sha===commit&&pr.head?.ref===BRANCH&&
   pr.head?.repo?.full_name===REPO&&
   pr.base?.ref===BASE&&pr.base?.repo?.full_name===REPO&&
   id(pr.user?.id)&&pr.user?.type==='User'&&
   !reviewerIds.includes(pr.user.id)&&
   commitDetails?.sha===commit&&
   commitDetails.commit?.verification?.verified===true&&
   Number.isSafeInteger(now)&&Number.isSafeInteger(committed)&&
   now>=committed&&now-committed<=14*86400000,
   'PR head, source/base, author separation, signed commit or freshness');
  const reviews=[];let done=false,pageCount=0;
  for(let page=1;page<=4;page++){
   const arr=await get('/pulls/168/reviews?per_page=100&page='+page);
   ok(Array.isArray(arr)&&arr.length<=100,
    'bounded complete PR reviews page required');
   pageCount++;
   reviews.push(...arr);
   if(arr.length<100){done=true;break;}
  }
  ok(done&&reviews.length>=2&&reviews.length<=400,
   'review pagination incomplete after four pages; NO-GO');
  const allIds=new Set(),latest=new Map();
  for(const r of reviews){
   ok(id(r?.id)&&id(r.user?.id)&&r.user.type==='User'&&
    !allIds.has(r.id)&&typeof r.state==='string'&&
    ['APPROVED','CHANGES_REQUESTED','DISMISSED',
     'COMMENTED','PENDING'].includes(r.state),
    'invalid, repeated or non-user review event');
   allIds.add(r.id);
   if(r.commit_id!==commit)continue;
   const ts=date(r.submitted_at);
   ok(Number.isSafeInteger(ts)&&ts>=committed&&ts<=now&&
    r.state!=='PENDING',
    'pending or undated current HEAD review cannot establish approval');
   const prev=latest.get(r.user.id);
   if(!prev||ts>prev.at||(ts===prev.at&&r.id>prev.id))
    latest.set(r.user.id,{id:r.id,at:ts,state:r.state});
  }
  const accepted=[];
  for(const rid of reviewerIds){
   const last=latest.get(rid);
   ok(rid!==pr.user.id&&last?.state==='APPROVED',
    'each expected reviewer must have final APPROVED on current head');
   accepted.push({reviewerId:rid,reviewId:last.id,submittedAtMs:last.at});
  }
  ok([...latest.values()].every(x=>x.state!=='CHANGES_REQUESTED'),
   'hidden or late changes requested on HEAD');
  accepted.sort((a,b)=>a.reviewerId-b.reviewerId);
  const evidence={
   schemaVersion:1,commit,branch:BRANCH,base:BASE,
   pullRequest:168,pageCount,reviewEventCount:reviews.length,
   reviewedEventsSha256:sha(reviews),
   reviewers:accepted,verifiedCommitSignatureObserved:true,
   completeHeadReviewHistoryInspected:true,
   hiddenChangedRequestsRejected:true,
   checkedAtMs:now,expiresAtMs:now+60000,
   independentNaturalHumanIdentityVerified:false,
   externalProviderIdentityIndependentlyAuthenticated:false,
   realPilotAuthorized:false,productionAuthorized:false
  };
  return Object.freeze({...evidence,evidenceSha256:sha(evidence)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,enabled:allowNetwork,realPilotAuthorized:false,
  productionAuthorized:false})});
}
