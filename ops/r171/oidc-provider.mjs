/**
 * R171 GitHub Actions OIDC acquisition for future manually protected staging.
 * This module does not claim that an environment is protected, a JWT signature
 * was checked, or an AWS STS role was actually assumed. AWS STS is the
 * signature authority, and an independent operator must confirm environment.
 * Never log the token, its bearer secret or the GitHub token request URL.
 */
import {inspectR170UnverifiedGitHubJwt} from '../r170/oidc-sts.mjs';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const REF='refs/heads/feature/marcosa-r150-growth-economics';
const fail=m=>{throw Error('R171 OIDC acquisition: '+m);};
const check=(v,m)=>{if(!v)fail(m);};
export function verifyR171ManualContext({env=process.env,clock=()=>Date.now()}={}){
 const expectedWorkflow=REPO+'/.github/workflows/marcosa-r171-live-staging.yml@'+REF;
 check(env&&env.GITHUB_ACTIONS==='true'&&
  env.GITHUB_REPOSITORY===REPO&&env.GITHUB_REF===REF&&
  env.GITHUB_EVENT_NAME==='workflow_dispatch'&&
  env.GITHUB_WORKFLOW_REF===expectedWorkflow&&
  env.MARCOSA_AWS_STAGING_ENV==='marcosa-aws-staging'&&
  env.MARCOSA_AWS_STAGING_PROTECTION_CONFIRMED==='true'&&
  env.MARCOSA_REAL_AWS_OPT_IN==='true'&&
  env.AWS_EC2_METADATA_DISABLED==='true'&&
  env.GITHUB_RUN_ATTEMPT==='1'&&
  /^[0-9]{5,20}$/.test(env.GITHUB_RUN_ID||'')&&
  /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
  env.GITHUB_REPOSITORY_ID==='1430301644'&&
  env.GITHUB_REPOSITORY_OWNER_ID==='340648536'&&
  !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
  !env.AWS_SESSION_TOKEN&&!env.AWS_PROFILE&&
  !env.AWS_ENDPOINT_URL,
  'protected manual staging workflow and immutable repository identity required');
 check(Number.isSafeInteger(clock())&&clock()>0,
  'trusted clock required');
 return Object.freeze({checked:true,repository:REPO,ref:REF,
  commit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,
  environmentLabelObserved:true,
  githubEnvironmentRulesIndependentlyVerified:false,
  productionAuthorized:false});
}
export function buildR171OidcRequest({env=process.env}={}){
 const ctx=verifyR171ManualContext({env});
 const raw=env.ACTIONS_ID_TOKEN_REQUEST_URL;
 const auth=env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 check(typeof raw==='string'&&raw.length<2048&&
  typeof auth==='string'&&auth.length>=20&&auth.length<=4096&&
  /^[A-Za-z0-9._~+/=-]+$/.test(auth),
  'GitHub OIDC request URL and bounded bearer token required');
 let url;
 try{url=new URL(raw);}catch{fail('malformed GitHub OIDC request URL');}
 // Never permit arbitrary URL SSRF or redirect. Valid GitHub token request
 // hosts are under the actions.githubusercontent.com DNS suffix; pin both
 // full hostname and server certificate through native fetch TLS.
 check(url.protocol==='https:'&&
  (url.hostname==='pipelines.actions.githubusercontent.com'||
   url.hostname==='vstoken.actions.githubusercontent.com')&&
  !url.port&&!url.username&&!url.password&&!url.hash&&
  /^\/[a-zA-Z0-9/_-]+$/.test(url.pathname)&&
  !url.searchParams.has('audience'),
  'GitHub OIDC endpoint host/path or audience override rejected');
 url.searchParams.set('audience','sts.amazonaws.com');
 return Object.freeze({url:url.href,authorization:'Bearer '+auth,
  commit:ctx.commit,productionAuthorized:false});
}
export function createR171OidcTokenProvider({
 env=process.env,fetcher=globalThis.fetch,clock=()=>Date.now(),
 allowNetwork=false
}={}){
 check(typeof fetcher==='function','controlled HTTPS fetch implementation required');
 async function acquire(){
  check(allowNetwork===true,'OIDC network disabled without manual staging approval');
  const req=buildR171OidcRequest({env});
  let response;
  try{
   response=await fetcher(req.url,{
    method:'GET',redirect:'error',cache:'no-store',
    headers:{Authorization:req.authorization,Accept:'application/json'},
    signal:AbortSignal.timeout(6000)
   });
  }catch{fail('GitHub OIDC request failed closed');}
  check(response&&response.status===200&&
   String(response.headers?.get?.('content-type')||'').includes('application/json'),
   'GitHub OIDC provider response status/type rejected');
  let content;
  try{content=await response.text();}catch{fail('GitHub OIDC response body unavailable');}
  check(typeof content==='string'&&content.length>150&&content.length<15000,
   'bounded GitHub OIDC response required');
  let value;
  try{value=JSON.parse(content);}catch{fail('invalid GitHub OIDC response JSON');}
  check(value&&typeof value.value==='string'&&
   (Object.keys(value).sort().join(',')==='count,value'||
    Object.keys(value).join(',')==='value')&&
   (value.count===undefined||value.count===1),
   'exact GitHub token provider response fields required');
  const probe=inspectR170UnverifiedGitHubJwt({
   jwt:value.value,
   expectedSubject:env.MARCOSA_EXPECTED_OIDC_SUB,
   ownerId:340648536,repoId:1430301644,
   commit:req.commit,clock
  });
  check(probe.signatureVerifiedLocally===false&&
   probe.productionAuthorized===false,
   'JWT local scope inspection is not AWS verification');
  return Object.freeze({idToken:value.value,
   idTokenSha256:probe.jwtSha256,expiresAtMs:probe.expiresAtMs,
   localScopeOnly:true,realStsVerificationRequired:true,
   productionAuthorized:false});
 }
 return Object.freeze({acquire,publicStatus:()=>Object.freeze({
  networkEnabled:allowNetwork,needsProtectedGitHubEnvironment:true,
  productionAuthorized:false})});
}
