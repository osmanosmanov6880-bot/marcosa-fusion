/** Read-only live GitHub PR review chronology. Mock fetch in CI never proves real identity. */
import {H40,H64,plain,keys,requireTrue,sealReceipt} from './common.mjs';
const repo='osmanosmanov6880-bot/marcosa-fusion',pr=168;
const base='https://api.github.com/repos/'+repo+'/pulls/'+pr;
const ROLES=['SECURITY','OPERATIONS','PRIVACY'];
const login=x=>typeof x==='string'&&/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(x);
export async function readR190GithubReviews({
 commit,bundleSha256,assignments={},fetchImpl=globalThis.fetch,
 token,sourceMode='CI_MOCK',clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  plain(assignments)&&typeof fetchImpl==='function'&&typeof clock==='function'&&
  ['CI_MOCK','OPERATOR_READONLY_UNATTESTED'].includes(sourceMode),
  'source-pinned GitHub observation required');
 requireTrue(Object.keys(assignments).every(k=>ROLES.includes(k))&&
  Object.values(assignments).every(login)&&
  new Set(Object.values(assignments).map(x=>x.toLowerCase())).size===
   Object.keys(assignments).length,'explicit distinct role assignments required');
 requireTrue(token===undefined||(typeof token==='string'&&token.length>=10&&token.length<=512&&
  !/[^\x21-\x7e]/.test(token)),'token must be opt-in and bounded');
 const headers={accept:'application/vnd.github+json',
  'x-github-api-version':'2022-11-28',
  'user-agent':'marcosa-r190-readonly-review'};
 if(token)headers.authorization='Bearer '+token;
 async function get(url){
  requireTrue(url===base||/^https:\/\/api\.github\.com\/repos\/osmanosmanov6880-bot\/marcosa-fusion\/pulls\/168\/reviews\?per_page=100&page=([1-9]|10)$/.test(url),
   'only pinned read-only GitHub PR URL allowed');
  let response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',
    headers,signal:AbortSignal.timeout(7000)});}catch{throw Error('R190: GitHub read unavailable');}
  requireTrue(response?.status===200&&response.redirected!==true&&
   (typeof response.url!=='string'||response.url===url),'GitHub HTTP status or redirect rejected');
  const raw=await response.text();
  requireTrue(typeof raw==='string'&&raw.length>0&&raw.length<=2000000,
   'GitHub response too large');
  let json;
  try{json=JSON.parse(raw);}catch{throw Error('R190: malformed GitHub JSON');}
  return json;
 }
 const meta=await get(base);
 requireTrue(meta&&meta.number===pr&&meta.head?.sha===commit&&
  meta.base?.ref!==undefined&&login(meta.user?.login)&&
  ['open','closed'].includes(meta.state),'GitHub PR head drift or identity missing');
 const author=meta.user.login.toLowerCase();
 const history=[];
 for(let page=1;page<=10;page++){
  const data=await get(base+'/reviews?per_page=100&page='+page);
  requireTrue(Array.isArray(data)&&data.length<=100,'unbounded GitHub review pagination');
  for(const item of data){
   requireTrue(Number.isSafeInteger(item.id)&&item.id>0&&
    login(item.user?.login)&&['User','Bot'].includes(item.user?.type)&&
    typeof item.state==='string'&&
    ['APPROVED','CHANGES_REQUESTED','COMMENTED','DISMISSED','PENDING'].includes(item.state)&&
    (item.commit_id===null||H40.test(item.commit_id||'')),
    'invalid review event or foreign commit');
   history.push({id:item.id,login:item.user.login.toLowerCase(),
    type:item.user.type,state:item.state,commit:item.commit_id});
  }
  if(data.length<100)break;
  requireTrue(page<10,'too many review events; fail closed');
 }
 requireTrue(history.length<=1000,'too many review events');
 // The last GitHub review event from a person is authoritative; a later
 // changes-requested or dismissal invalidates an earlier approval.
 history.sort((a,b)=>a.id-b.id);
 const latest=new Map();
 for(const r of history)latest.set(r.login,r);
 const checks=ROLES.map(role=>{
  const subject=assignments[role]?.toLowerCase()||null;
  const item=subject?latest.get(subject):null;
  return{role,reviewer:subject,approved:!!item&&
   subject!==author&&item.type==='User'&&
   item.state==='APPROVED'&&item.commit===commit};
 });
 const at=clock();
 requireTrue(Number.isSafeInteger(at)&&at>0,'valid observation time required');
 return sealReceipt({schemaVersion:1,kind:'R190_GITHUB',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode,repo,pullRequest:pr,authorLogin:author,
  observedReviews:history.length,reviewChecks:checks,
  reviewerRoleMembershipExternallyVerified:false,
  allCurrentHeadReviewClaimsSatisfied:checks.every(c=>c.approved),
  identitiesIndependentlyEstablished:false,
  observedAtMs:at,decision:'NO_GO_EXTERNAL_REVIEWER_IDENTITY_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
