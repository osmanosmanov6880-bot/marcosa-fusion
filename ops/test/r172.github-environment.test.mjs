import test from 'node:test';
import assert from 'node:assert/strict';
import {createR172GitHubEnvironmentAudit,verifyR172GitHubEnvironmentAudit}
 from '../r172/github-environment.mjs';
const now=1800000000000,clock=()=>now,commit='a'.repeat(40);
const repo='osmanosmanov6880-bot/marcosa-fusion',
 branch='feature/marcosa-r150-growth-economics';
const env={
 GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repo,
 GITHUB_REF:'refs/heads/'+branch,
 GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',
 GITHUB_RUN_ID:'44567891234',GITHUB_SHA:commit,
 GITHUB_REPOSITORY_ID:'1430301644',
 GITHUB_REPOSITORY_OWNER_ID:'340648536',
 MARCOSA_GITHUB_ENV_AUDIT_TOKEN:'ci-only-'+ 'x'.repeat(30)
};
function fixture({noReview=false,selfReview=false,wildcard=false,
 actorReviewer=false,redirect=false,failedRead=false,badSha=false}={}){
 const environment={id:233333,name:'marcosa-aws-staging',
  deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
  protection_rules:[
   {type:'branch_policy'},
   ...(noReview?[]:[{type:'required_reviewers',
    prevent_self_review:!selfReview,
    reviewers:[{type:'User',reviewer:{id:actorReviewer?44:1001}},
     {type:'User',reviewer:{id:1002}}]}])
  ]};
 const policies={total_count:1,branch_policies:[{
  name:wildcard?'feature/*':branch}]};
 const run={event:'workflow_dispatch',
  head_branch:branch,head_sha:badSha?'b'.repeat(40):commit,run_attempt:1,
  repository:{full_name:repo,id:1430301644,owner:{id:340648536}},
  head_repository:{id:1430301644},actor:{id:44},
  path:'.github/workflows/marcosa-r171-live-staging.yml@refs/heads/'+branch,
  status:'in_progress'};
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});
  if(failedRead)throw Error('private');
  const data=url.includes('/deployment-branch-policies?')?policies:
   url.includes('/actions/runs/')?run:environment;
  return{status:redirect?302:200,
   headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(data)};
 };
 const audit=createR172GitHubEnvironmentAudit({
  fetcher,env,clock,allowExternalCalls:true});
 return{audit,calls};
}
test('R172 verifies GitHub protected staging reviewers, exact branch and matching manual run',async()=>{
 const f=fixture(),proof=await f.audit.inspect();
 assert.equal(proof.verified,true);
 assert.equal(proof.reviewerCount,2);
 assert.equal(proof.preventSelfReview,true);
 assert.equal(proof.productionAuthorized,false);
 assert.equal(proof.twoActualHumanApprovalsVerified,false);
 assert.equal(f.calls.length,3);
 assert.ok(f.calls.every(x=>x.opts.redirect==='error'&&x.opts.method==='GET'));
 assert.equal(verifyR172GitHubEnvironmentAudit(proof,{commit,clock})
  .readOnlyEnvironmentVerified,true);
});
test('R172 environment audit refuses unprotected, self-review, wildcard, self-actor and network problems',async()=>{
 for(const opts of [
  {noReview:true},{selfReview:true},{wildcard:true},
  {actorReviewer:true},{redirect:true},{failedRead:true},{badSha:true}
 ])await assert.rejects(fixture(opts).audit.inspect(),/R172 GitHub environment/);
 const good=await fixture().audit.inspect();
 assert.throws(()=>verifyR172GitHubEnvironmentAudit(good,{
  commit,clock:()=>now+61000}),/R172 GitHub environment/);
});
test('R172 default mode does not call GitHub APIs',async()=>{
 const f=createR172GitHubEnvironmentAudit({
  fetcher:async()=>{throw Error('network should never happen');},
  env,clock
 });
 await assert.rejects(f.inspect(),/read-only GitHub environment audit token required/);
});
