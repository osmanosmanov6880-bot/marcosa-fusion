import test from 'node:test';
import assert from 'node:assert/strict';
import {buildR171OidcRequest,createR171OidcTokenProvider,
 verifyR171ManualContext} from '../r171/oidc-provider.mjs';
import {r169GitHubOidcSubject} from '../r169/iam-plan.mjs';
const now=1800000000000,clock=()=>now,commit='a'.repeat(40);
const expectedSubject=r169GitHubOidcSubject({
 ownerId:340648536,repoId:1430301644,subjectMode:'legacy'
});
const env={
 GITHUB_ACTIONS:'true',
 GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
 GITHUB_REF:'refs/heads/feature/marcosa-r150-growth-economics',
 GITHUB_WORKFLOW_REF:'osmanosmanov6880-bot/marcosa-fusion/.github/workflows/marcosa-r171-live-staging.yml@refs/heads/feature/marcosa-r150-growth-economics',
 GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'12345678900',
 GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:commit,
 GITHUB_REPOSITORY_ID:'1430301644',GITHUB_REPOSITORY_OWNER_ID:'340648536',
 MARCOSA_AWS_STAGING_ENV:'marcosa-aws-staging',
 MARCOSA_AWS_STAGING_PROTECTION_CONFIRMED:'true',
 MARCOSA_REAL_AWS_OPT_IN:'true',AWS_EC2_METADATA_DISABLED:'true',
 MARCOSA_EXPECTED_OIDC_SUB:expectedSubject,
 ACTIONS_ID_TOKEN_REQUEST_URL:
 'https://pipelines.actions.githubusercontent.com/4/5/idtoken?api-version=2.0',
 ACTIONS_ID_TOKEN_REQUEST_TOKEN:'c'.repeat(50)
};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(){
 const p={iss:'https://token.actions.githubusercontent.com',
  aud:'sts.amazonaws.com',sub:expectedSubject,
  repository:env.GITHUB_REPOSITORY,ref:env.GITHUB_REF,sha:commit,
  repository_id:env.GITHUB_REPOSITORY_ID,
  repository_owner_id:env.GITHUB_REPOSITORY_OWNER_ID,
  iat:Math.floor(now/1000)-10,exp:Math.floor(now/1000)+300};
 return b64({alg:'RS256',typ:'JWT'})+'.'+b64(p)+'.'+'A'.repeat(86);
}
test('R171 request pins exact manual protected branch and AWS STS audience',()=>{
 const v=verifyR171ManualContext({env,clock});
 assert.equal(v.checked,true);
 assert.equal(v.githubEnvironmentRulesIndependentlyVerified,false);
 const req=buildR171OidcRequest({env});
 assert.ok(req.url.includes('audience=sts.amazonaws.com'));
 assert.ok(req.authorization.startsWith('Bearer '));
 assert.equal(req.productionAuthorized,false);
});
test('R171 real fetch contract validates bounded JSON JWT and keeps signature verification at AWS STS',async()=>{
 let calls=0;
 const fetcher=async (url,options)=>{
  calls++;
  assert.equal(new URL(url).hostname,'pipelines.actions.githubusercontent.com');
  assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');
  assert.equal(options.method,'GET');
  return{status:200,headers:{get:()=> 'application/json; charset=utf-8'},
   text:async()=>JSON.stringify({count:1,value:jwt()})};
 };
 const provider=createR171OidcTokenProvider({env,clock,fetcher,allowNetwork:true});
 const result=await provider.acquire();
 assert.equal(calls,1);
 assert.equal(result.idToken,jwt());
 assert.equal(result.localScopeOnly,true);
 assert.equal(result.realStsVerificationRequired,true);
 assert.equal(result.productionAuthorized,false);
});
test('R171 rejects no opt-in, spoofed hostname/branch, unprotected environment and redirects',async()=>{
 for(const patch of [
  {GITHUB_REF:'refs/heads/main'},
  {GITHUB_RUN_ATTEMPT:'2'},
  {MARCOSA_AWS_STAGING_PROTECTION_CONFIRMED:'false'},
  {ACTIONS_ID_TOKEN_REQUEST_URL:'https://evil.example/idtoken'},
  {ACTIONS_ID_TOKEN_REQUEST_URL:'http://pipelines.actions.githubusercontent.com/4/idtoken'},
  {ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/4/idtoken?audience=evil'},
  {AWS_ACCESS_KEY_ID:'AKIA'+'Z'.repeat(16)}
 ])assert.throws(()=>buildR171OidcRequest({env:{...env,...patch}}),/R171 OIDC acquisition/);
 const off=createR171OidcTokenProvider({env,clock,fetcher:async()=>{throw Error('network');}});
 await assert.rejects(off.acquire(),/network disabled/);
 const bad=createR171OidcTokenProvider({env,clock,allowNetwork:true,
  fetcher:async()=>({status:302,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify({value:jwt()})})});
 await assert.rejects(bad.acquire(),/response status/);
});
