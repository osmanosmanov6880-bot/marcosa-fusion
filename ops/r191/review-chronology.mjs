/** R191: PR #168 review chronology with two independent head readbacks.
 * Read-only API, bounded pagination, source-pinned; CI mock != real approval. */
import {H40,H64,plain,requireTrue,sealReceipt} from '../r190/common.mjs';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const BRANCH='feature/marcosa-r150-growth-economics';
const BASE='feature/series-pilot-r149';
const ROLES=['SECURITY','OPERATIONS','PRIVACY'];
const api='https://api.github.com/repos/'+REPO,root=api+'/pulls/168';
const isId=x=>Number.isSafeInteger(x)&&x>0;
const ms=x=>typeof x==='string'?Date.parse(x):NaN;
function assignments(x){
 requireTrue(plain(x)&&Object.keys(x).sort().join(',')===ROLES.slice().sort().join(','),
  'all three reviewer roles required');
 const ids=ROLES.map(role=>x[role]);
 requireTrue(ids.every(isId)&&new Set(ids).size===3,
  'three distinct GitHub reviewer IDs required');
}
export async function inspectR191GithubReviews({
 commit,bundleSha256,reviewerIds,fetchImpl=globalThis.fetch,
 token,allowNetwork=false,sourceMode='CI_FIXTURE',clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof fetchImpl==='function'&&typeof clock==='function'&&
  ['CI_FIXTURE','OPERATOR_READONLY_UNATTESTED'].includes(sourceMode),
  'exact reviewed SHA and read-only source mode required');
 assignments(reviewerIds);
 requireTrue(allowNetwork===true,'GitHub API inspection is opt-in only');
 if(sourceMode==='OPERATOR_READONLY_UNATTESTED')
  requireTrue(typeof token==='string'&&/^[A-Za-z0-9._-]{12,4096}$/.test(token),
   'operator must supply a scoped read-only GitHub token');
 else requireTrue(token===undefined,'fixture mode must not receive credentials');
 const fixed=new Set([root,api+'/commits/'+commit]);
 async function get(url){
  const reviewPrefix=root+'/reviews?per_page=100&page=';
  const suffix=url.startsWith(reviewPrefix)?url.slice(reviewPrefix.length):'';
  requireTrue(fixed.has(url)||/^(?:[1-9]|10)$/.test(suffix),
   'only fixed GitHub PR, review or commit URL may be read');
  let response;
  const headers={accept:'application/vnd.github+json',
   'x-github-api-version':'2022-11-28','user-agent':'marcosa-r191-readonly'};
  if(token)headers.authorization='Bearer '+token;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',
    headers,signal:AbortSignal.timeout(8000)});}
  catch{throw Error('R191: GitHub read unavailable');}
  requireTrue(response?.status===200&&response.redirected!==true&&
   (typeof response.url!=='string'||response.url===url)&&
   /json/i.test(response.headers?.get?.('content-type')||''),
   'GitHub returned non-200, redirect or non-JSON');
  const raw=await response.text();
  requireTrue(typeof raw==='string'&&raw.length>=2&&raw.length<=1200000,
   'bounded GitHub JSON required');
  try{return JSON.parse(raw);}catch{throw Error('R191: invalid GitHub JSON');}
 }
 function exactHead(p){
  requireTrue(p?.number===168&&p.state==='open'&&p.draft===false&&
   p.head?.sha===commit&&p.head?.ref===BRANCH&&
   p.head?.repo?.full_name===REPO&&p.base?.ref===BASE&&
   p.base?.repo?.full_name===REPO&&isId(p.user?.id)&&
   p.user.type==='User','PR, base, author or head drifted');
 }
 const started=clock();
 requireTrue(Number.isSafeInteger(started)&&started>0,'valid clock required');
 const initial=await get(root);
 exactHead(initial);
 requireTrue(!Object.values(reviewerIds).includes(initial.user.id),
  'PR author cannot approve their own work');
 const commitInfo=await get(api+'/commits/'+commit);
 requireTrue(commitInfo?.sha===commit&&
  typeof commitInfo.commit?.verification?.verified==='boolean',
  'exact commit verification status missing');
 const committed=ms(commitInfo.commit?.committer?.date);
 requireTrue(Number.isFinite(committed)&&committed<=started&&
  started-committed<=14*86400000,'commit timestamp stale or future');
 const history=[],ids=new Set();
 for(let page=1;page<=10;page++){
  const batch=await get(root+'/reviews?per_page=100&page='+page);
  requireTrue(Array.isArray(batch)&&batch.length<=100,'invalid review page');
  for(const r of batch){
   requireTrue(isId(r?.id)&&!ids.has(r.id)&&isId(r.user?.id)&&
    ['User','Bot'].includes(r.user.type)&&
    ['APPROVED','CHANGES_REQUESTED','COMMENTED','DISMISSED','PENDING']
     .includes(r.state)&&
    (r.commit_id===null||H40.test(r.commit_id||'')),
    'duplicate or invalid review event');
   ids.add(r.id);
   const when=ms(r.submitted_at);
   if(r.state!=='PENDING')requireTrue(Number.isFinite(when)&&
    when>0&&when<=started,'review timestamp invalid or stale');
   history.push({id:r.id,userId:r.user.id,type:r.user.type,
    state:r.state,commit:r.commit_id,
    submitted:Number.isFinite(when)?when:null});
  }
  if(batch.length<100)break;
  requireTrue(page<10,'review pagination incomplete');
 }
 const latest=new Map();
 for(const r of history){
  const prev=latest.get(r.userId);
  if(!prev||(r.submitted??-1)>(prev.submitted??-1)||
   ((r.submitted??-1)===(prev.submitted??-1)&&r.id>prev.id))
   latest.set(r.userId,r);
 }
 const checks=ROLES.map(role=>{
  const userId=reviewerIds[role],review=latest.get(userId);
  return {role,githubUserId:userId,reviewId:review?.id||null,
   latestState:review?.state||'MISSING',
   approved:!!review&&review.type==='User'&&
    review.state==='APPROVED'&&review.commit===commit};
 });
 const unresolved=[...latest.values()].filter(r=>
  r.commit===commit&&r.state==='CHANGES_REQUESTED');
 const after=await get(root);
 exactHead(after);
 requireTrue(initial.user.id===after.user.id,'PR author changed during read');
 const finished=clock();
 requireTrue(Number.isSafeInteger(finished)&&finished>=started&&
  finished-started<=30000,'PR review read was not atomic enough');
 return sealReceipt({schemaVersion:1,kind:'R191_PR',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode,repository:REPO,pullRequest:168,
  commitSignatureVerifiedByGithub:commitInfo.commit.verification.verified===true,
  reviewerRoleMembershipVerified:false,
  reviewPagesComplete:true,totalReviewEvents:history.length,
  unresolvedChangesOnHead:unresolved.length,reviewChecks:checks,
  allRequiredReviewEventsObserved:checks.every(r=>r.approved)&&unresolved.length===0,
  independentHumanIdentityVerified:false,
  providerDataAuthenticityIndependentlyVerified:false,
  observedAtMs:finished,expiresAtMs:finished+60000,
  decision:'NO_GO_INDEPENDENT_REVIEWER_PROVENANCE_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
