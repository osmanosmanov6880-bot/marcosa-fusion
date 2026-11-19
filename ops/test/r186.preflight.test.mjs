import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createR186GithubPreflight} from '../r186/github-preflight.mjs';
import {createR186HttpsPreflight,validateR186StagingHostname}
 from '../r186/https-preflight.mjs';
import {createR186StagingAssessment,R186_BLOCKER_CODES}
 from '../r186/staging-assessment.mjs';
import {r186ObservationSql,createR186ObservationLedger}
 from '../r186/observation-ledger.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=1800000000000,clock=()=>now;
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 runId=123456789,nonce='c'.repeat(32);
const rep='osmanosmanov6880-bot/marcosa-fusion';
const repo={full_name:rep},stage='staging.marcosa.example.com';
function git({approvals=2,rejected=false,missingEnv=false,
 badSha=false,badSignature=false,unauthorized=false,
 manyPages=false,changedHead=false,mode='CI_SYNTHETIC'}={}){
 const pr={number:168,state:'open',user:{id:1001,type:'User'},
  head:{sha:badSha?'f'.repeat(40):commit,
   ref:'feature/marcosa-r150-growth-economics',repo},
  base:{ref:'feature/series-pilot-r149',repo}};
 const c={sha:commit,commit:{committer:{
  date:new Date(now-3000).toISOString()
 },verification:{verified:!badSignature}}};
 const environment={name:'marcosa-aws-staging',protection_rules:[
  {type:'required_reviewers',reviewers:[{id:1002},{id:1003}]}
 ]};
 const events=Array.from({length:manyPages?400:approvals},(_,i)=>({
  id:i+1,user:{id:2000+i,type:'User'},
  commit_id:changedHead?'f'.repeat(40):commit,state:'APPROVED',
  submitted_at:new Date(now-1000).toISOString()
 }));
 if(rejected)events.push({id:99,user:{id:2000,type:'User'},
  commit_id:commit,state:'CHANGES_REQUESTED',
  submitted_at:new Date(now-500).toISOString()});
 const fetcher=async(url,opts)=>{
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  const page=/page=(\d+)$/.exec(url);
  if(unauthorized)return{status:403,headers:{get:()=> 'application/json'},
   text:async()=> '{"message":"denied"}'};
  if(url.includes('/environments/')&&missingEnv)
   return{status:404,headers:{get:()=> 'application/json'}};
  const data=page?events.slice((Number(page[1])-1)*100,
   Number(page[1])*100):
   url.includes('/environments/')?environment:
   url.includes('/commits/')?c:pr;
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(data)};
 };
 return createR186GithubPreflight({fetcher,clock,allowNetwork:true,
  sourceMode:mode,token:'synthetic-r186-github-readonly-token'});
}
function https({badHealth=false,badHeaders=false,redirect=false,
 nonJson=false,unavailable=false,mode='CI_SYNTHETIC'}={}){
 const fetcher=async(url,opts)=>{
  assert.ok(url.startsWith('https://'+stage+'/'));
  assert.equal(opts.redirect,'error');
  assert.equal(opts.credentials,'omit');
  assert.equal(opts.headers.Authorization,undefined);
  if(unavailable)throw Error('read-only request timed out');
  const good={
   'cache-control':'private, no-store',
   'x-content-type-options':badHeaders?'':'nosniff',
   'strict-transport-security':'max-age=63072000; includeSubDomains',
   'content-type':nonJson?'text/html':'application/json'
  };
  const body=url.endsWith('/health')?
   {status:badHealth?'down':'ok'}:{status:'ready'};
  return{status:redirect?301:200,url,redirected:false,
   headers:{get:n=>good[n.toLowerCase()]||null},
   text:async()=>JSON.stringify(body)};
 };
 return createR186HttpsPreflight({
  hostname:stage,fetcher,clock,allowNetwork:true,sourceMode:mode
 });
}
const r185Raw={
 schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
 runId,sequence:3,nonce,
 sourceMode:'CI_SYNTHETIC',
 decision:'NO_GO_STAGING_BLOCKERS_UNRESOLVED',
 realPilotAuthorized:false,productionAuthorized:false
};
const prior={...r185Raw,evidenceSha256:hash(r185Raw)};
const report={
 schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
 hold:prior,
 realPg17NativeRestoreAndAudit:true,
 realPg17RlsAndQuarantineRestored:true,
 realPg17ReplayDenied:true,
 syntheticProviderEvidenceOnly:true,
 syntheticCanaryOnly:true,
 realProviderVerified:false,realProductionRecoveryVerified:false,
 realPilotAuthorized:false,productionAuthorized:false
};
const witness={runId,sequence:3,nonce,
 sourceCommit:commit,r185EvidenceSha256:prior.evidenceSha256,
 decision:prior.decision,productionAuthorized:false};
async function assess({open=false,race=false,forgeGh=false,
 fakeHttps=false,mode='CI_SYNTHETIC'}={}){
 const g=await git({mode}).inspect({commit,bundleSha256});
 const h=await https({mode}).inspect({commit,bundleSha256});
 const altered=forgeGh?{...g,realHumanIdentityIndependentlyAttested:true}:g;
 const alteredHttp=fakeHttps?{...h,externalTlsIdentityIndependentlyAttested:true}:h;
 let reads=0;
 const a=createR186StagingAssessment({
  readR185Hold:async()=>{
   reads++;return race&&reads>1?{...witness,sequence:4}:witness;
  },
  quarantine:{status:async()=>({closed:!open,generation:5})},
  clock,allowInspect:true
 });
 return a.inspect({commit,bundleSha256,r185Report:report,
  githubProof:altered,httpsProof:alteredHttp});
}
test('R186 GitHub read-only inspection accepts exact signed HEAD and complete current reviews',async()=>{
 const v=await git().inspect({commit,bundleSha256});
 assert.equal(v.observedPrReviewEvents,2);
 assert.equal(v.currentHeadUniqueApprovals,2);
 assert.equal(v.githubEnvironmentConfigured,true);
 assert.equal(v.readyForIndependentHumanReview,true);
 assert.equal(v.realHumanIdentityIndependentlyAttested,false);
 assert.equal(v.productionAuthorized,false);
 const noEnv=await git({missingEnv:true}).inspect({commit,bundleSha256});
 assert.equal(noEnv.environmentReviewProtectionConfigured,false);
 assert.equal(noEnv.readyForIndependentHumanReview,false);
 const none=await git({approvals:0}).inspect({commit,bundleSha256});
 assert.equal(none.currentHeadUniqueApprovals,0);
 assert.equal(none.readyForIndependentHumanReview,false);
 const request=await git({rejected:true}).inspect({commit,bundleSha256});
 assert.equal(request.currentHeadUnresolvedChanges,1);
 assert.equal(request.readyForIndependentHumanReview,false);
 const invalid=await git({changedHead:true}).inspect({commit,bundleSha256});
 assert.equal(invalid.currentHeadUniqueApprovals,0);
 for(const v of [{badSha:true},{unauthorized:true},{manyPages:true}])
  await assert.rejects(git(v).inspect({commit,bundleSha256}),
   /R186 GitHub preflight/,JSON.stringify(v));
 const unsigned=await git({badSignature:true}).inspect({commit,bundleSha256});
 assert.equal(unsigned.verifiedSignedCommit,false);
 assert.equal(unsigned.readyForIndependentHumanReview,false);
});
test('R186 staging HTTP probes require explicit pinned FQDN and GET/HEAD TLS/header contract',async()=>{
 for(const host of ['localhost','127.0.0.1','staging.local',
  'http://staging.example.com','staging.example.com:443',
  'staging.example.com/health','staging.example..com'])
 assert.throws(()=>validateR186StagingHostname(host),
  /R186 HTTPS preflight/);
 const r=await https().inspect({commit,bundleSha256});
 assert.equal(r.readOnlyRequests,3);
 assert.equal(r.checks.length,3);
 assert.equal(r.healthAndSecurityPassed,true);
 assert.equal(r.noCredentialsSent,true);
 assert.equal(r.responseBodiesRetained,false);
 assert.equal(r.productionAuthorized,false);
 for(const fault of [{badHealth:true},{badHeaders:true},
  {redirect:true},{nonJson:true},{unavailable:true}]){
  const x=await https(fault).inspect({commit,bundleSha256});
  assert.equal(x.healthAndSecurityPassed,false,JSON.stringify(fault));
  assert.equal(x.actualDeploymentAttempted,false);
 }
});
test('R186 staging assessment separates synthetic observation from real independent authorization',async()=>{
 const x=await assess();
 assert.equal(R186_BLOCKER_CODES.length,5);
 assert.equal(x.checks.length,5);
 assert.equal(x.hardBlockingChecks,5);
 assert.ok(x.checks.every(c=>c.state==='BLOCKED'));
 assert.equal(x.githubPrCurrentHeadApprovalsObserved,2);
 assert.equal(x.stagingHttpAllChecksObservedPassed,true);
 assert.equal(x.realPilotAuthorized,false);
 assert.equal(x.productionAuthorized,false);
 const manual=await assess({mode:'OPERATOR_READONLY_UNATTESTED'});
 assert.equal(manual.checks[0].state,'OBSERVED_PENDING_INDEPENDENT_IDENTITY');
 assert.equal(manual.checks[1].state,'OBSERVED_PENDING_EXTERNAL_TLS_ATTESTATION');
 assert.equal(manual.realPilotAuthorized,false);
 for(const fault of [{open:true},{race:true},{forgeGh:true},
  {fakeHttps:true}])
 await assert.rejects(assess(fault),/R186 staging assessment/,
  JSON.stringify(fault));
});
test('R186 real PostgreSQL17 SQL packet binds exact R185 evidence and is fail-closed against replay',async()=>{
 const p=await assess(),sql=r186ObservationSql(p);
 for(const part of ['SERIALIZABLE','marcosa_r186_writer',
  'r185_ci.readiness_holds','r185_ci.readiness_audit',
  'r186_ci.staging_observation_holds','r186_ci.staging_observation_audit',
  'ON CONFLICT DO NOTHING'])
 assert.ok(sql.includes(part),part);
 for(const bad of [{sourceMode:'OPERATOR_READONLY_UNATTESTED'},
  {productionAuthorized:true},{decision:'STAGING_GO'},
  {nonce:"' OR 1=1"},{hardBlockingChecks:0},
  {githubEvidenceSha256:'x'}])
 assert.throws(()=>r186ObservationSql({...p,...bad}),
  /R186 observation ledger/);
 let n=0;
 const ledger=createR186ObservationLedger({executeSql:async()=>n++===0?
  'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'});
 assert.equal((await ledger.record(p)).recorded,true);
 await assert.rejects(ledger.record(p),/R186 observation ledger/);
});
