/**
 * R186 two-runner technical acceptance:
 * - zero real cloud credentials, read-only *synthetic* provider responses
 * - actual disposable PG17 R185 predecessor and R167 quarantine
 * - source-bound GitHub PR/Environment and HTTPS observation assessment
 * - immutable native R186 SERIALIZABLE/FORCE RLS one-use hold and audit
 * - actual PostgreSQL17 pg_dump -Fc/pg_restore + replay rejection
 * - separate no-DB/no-cloud runner re-hashes full source and proofs.
 *
 * THIS DOES NOT PROVE LIVE GITHUB REVIEWERS, HTTPS, AWS OR STAGING GO.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR186GithubPreflight} from './github-preflight.mjs';
import {createR186HttpsPreflight} from './https-preflight.mjs';
import {createR186StagingAssessment} from './staging-assessment.mjs';
import {createR186ObservationLedger} from './observation-ledger.mjs';
const env=process.env;
const fail=m=>{throw Error('R186 native CI: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const jsonHash=x=>sha(Buffer.from(JSON.stringify(x)));
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const reportFile='r186-staging-preflight-no-go-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'real AWS, customer secrets or OIDC must never enter R186 CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R186_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R186_PG_CONTAINER,
  'independent second runner cannot receive PostgreSQL secrets');
 const report=JSON.parse(await readFile(join(
  env.RUNNER_TEMP,'r186-second',reportFile),'utf8'));
 const keys=['schemaVersion','commit','sourceBundleSha256','r185Report',
  'githubProof','httpsProof','assessment','assessmentEvidenceSha256',
  'realPg17RestoreRlsAndAudit','realPg17ReplayDenied',
  'syntheticGithubApiOnly','syntheticHttpsTransportOnly',
  'realGithubHumanApprovalsVerified','realHttpsTlsIndependentlyAttested',
  'realAwsEffectiveRightsVerified','realPilotAuthorized',
  'productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===keys&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256,
  'independent report schema or exact pinned source mismatch');
 const p=report.r185Report?.hold;
 const {evidenceSha256:priorSha,...prior}=p||{};
 ok(report.r185Report?.commit===commit&&
  report.r185Report?.sourceBundleSha256===bundle.sha256&&
  p?.sourceCommit===commit&&
  p.decision==='NO_GO_STAGING_BLOCKERS_UNRESOLVED'&&
  p.realPilotAuthorized===false&&p.productionAuthorized===false&&
  H64.test(priorSha||'')&&jsonHash(prior)===priorSha,
  'R185 immutable predecessor altered');
 const g=report.githubProof,{evidenceSha256:ghSha,...ghRaw}=g||{};
 ok(g?.sourceMode==='CI_SYNTHETIC'&&
  g.sourceCommit===commit&&
  g.sourceBundleSha256===bundle.sha256&&
  g.headMatchesReviewedCheckout===true&&
  g.historyComplete===true&&g.githubEnvironmentConfigured===true&&
  g.realHumanIdentityIndependentlyAttested===false&&
  g.realGitHubDeploymentAuthorizationVerified===false&&
  g.realPilotAuthorized===false&&g.productionAuthorized===false&&
  H64.test(ghSha||'')&&jsonHash(ghRaw)===ghSha,
  'synthetic GitHub preflight source or SHA invalid');
 const h=report.httpsProof,{evidenceSha256:httpsSha,...httpRaw}=h||{};
 ok(h?.sourceMode==='CI_SYNTHETIC'&&h.sourceCommit===commit&&
  h.sourceBundleSha256===bundle.sha256&&
  h.readOnlyRequests===3&&h.checks?.length===3&&
  h.noCredentialsSent===true&&h.responseBodiesRetained===false&&
  h.externalTlsIdentityIndependentlyAttested===false&&
  h.actualDeploymentAttempted===false&&
  h.realPilotAuthorized===false&&h.productionAuthorized===false&&
  H64.test(httpsSha||'')&&jsonHash(httpRaw)===httpsSha,
  'read-only synthetic HTTPS metadata cannot be called TLS attestation');
 const a=report.assessment,{evidenceSha256:assSha,...raw}=a||{};
 ok(a?.sourceCommit===commit&&
  a.sourceBundleSha256===bundle.sha256&&
  a.r185EvidenceSha256===priorSha&&
  a.githubEvidenceSha256===ghSha&&
  a.httpsEvidenceSha256===httpsSha&&
  a.sourceMode==='CI_SYNTHETIC'&&a.hardBlockingChecks===5&&
  a.checks?.length===5&&a.checks.every(x=>x.state==='BLOCKED')&&
  a.realGitHubHumanIdentityVerified===false&&
  a.realAwsEffectivePermissionsVerified===false&&
  a.realTlsIdentityIndependentlyVerified===false&&
  a.stagingPrivacyIndependentlyVerified===false&&
  a.realStagingRpoRtoVerified===false&&
  a.quarantineClosed===true&&
  a.decision==='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'&&
  a.realPilotAuthorized===false&&a.productionAuthorized===false&&
  H64.test(assSha||'')&&jsonHash(raw)===assSha&&
  report.assessmentEvidenceSha256===assSha,
  'independent immutable NO-GO source/hashes mismatch');
 for(const k of ['realPg17RestoreRlsAndAudit','realPg17ReplayDenied',
  'syntheticGithubApiOnly','syntheticHttpsTransportOnly'])
  ok(report[k]===true,'required CI proof missing: '+k);
 for(const k of ['realGithubHumanApprovalsVerified',
  'realHttpsTlsIndependentlyAttested','realAwsEffectiveRightsVerified',
  'realPilotAuthorized','productionAuthorized'])
  ok(report[k]===false,'synthetic evidence cannot authorize staging');
 console.log('R186_SECOND_RUNNER_EXACT_SOURCE_AND_NO_GO_HASHES=PASS');
 console.log('R186_REAL_GITHUB_HUMANS_TLS_AWS_AND_PILOT=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R186_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'real disposable PG17 and exact GH run ID required');
 const cmd=(program,args,{input}={})=>{
  const r=spawnSync(program,args,{input,encoding:null,
   timeout:120000,maxBuffer:48*1024*1024});
  ok(r.status===0&&!r.error,'native PostgreSQL17 command failed: '+program);
  return r.stdout;
 };
 const sql=(db,q)=>cmd('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1',
  '-d',db,'-c',q]).toString('utf8').trim();
 const prev=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r185-staging-operator-no-go-report.json'),'utf8'));
 const prior=prev.hold,runId=Number(env.GITHUB_RUN_ID);
 ok(prev.schemaVersion===1&&prev.commit===commit&&
  prev.sourceBundleSha256===bundle.sha256&&
  prior?.runId===runId&&prior.sourceCommit===commit&&
  prior.decision==='NO_GO_STAGING_BLOCKERS_UNRESOLVED'&&
  prior.realPilotAuthorized===false&&
  prior.productionAuthorized===false&&
  prev.realPg17NativeRestoreAndAudit===true&&
  prev.realPg17RlsAndQuarantineRestored===true&&
  prev.realPg17ReplayDenied===true&&
  prev.syntheticProviderEvidenceOnly===true&&
  prev.syntheticCanaryOnly===true&&
  prev.realProviderVerified===false&&
  prev.realProductionRecoveryVerified===false&&
  prev.realPilotAuthorized===false&&prev.productionAuthorized===false,
  'actual R185 disposable PG17 NO-GO prerequisite missing');
 const clock=()=>Date.now();
 let ghCalls=0;
 const ghFetcher=async(url,request)=>{
  ghCalls++;
  ok(request?.method==='GET'&&request.redirect==='error'&&
   url.startsWith('https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion/'),
   'no provider write or off-origin request in CI');
  const now=clock(),repo={full_name:'osmanosmanov6880-bot/marcosa-fusion'};
  const page=/page=(\d+)$/.exec(url);
  const events=[{id:1,user:{id:2002,type:'User'},commit_id:commit,
   state:'APPROVED',submitted_at:new Date(now-300).toISOString()},
   {id:2,user:{id:3003,type:'User'},commit_id:commit,
    state:'APPROVED',submitted_at:new Date(now-250).toISOString()}];
  const data=page?Number(page[1])===1?events:[]:
   url.includes('/environments/')?
   {name:'marcosa-aws-staging',protection_rules:[{
    type:'required_reviewers',reviewers:[{id:2002},{id:3003}]
   }]}:
   url.includes('/commits/')?
   {sha:commit,commit:{committer:{date:new Date(now-2000).toISOString()},
    verification:{verified:true}}}:
   {number:168,state:'open',user:{id:1001,type:'User'},
    head:{sha:commit,ref:'feature/marcosa-r150-growth-economics',repo},
    base:{ref:'feature/series-pilot-r149',repo}};
  return{status:200,headers:{get:n=>'content-type'===n?'application/json':null},
   text:async()=>JSON.stringify(data)};
 };
 const github=await createR186GithubPreflight({
  fetcher:ghFetcher,token:'ci-synthetic-r186-readonly-token',
  clock,sourceMode:'CI_SYNTHETIC',allowNetwork:true
 }).inspect({commit,bundleSha256:bundle.sha256});
 ok(ghCalls===4&&github.historyComplete===true&&
  github.currentHeadUniqueApprovals===2&&
  github.realHumanIdentityIndependentlyAttested===false,
  'exact injected synthetic GitHub environment/review controls required');
 const host='staging.marcosa.example.com';
 let httpCalls=0;
 const fetchHttp=async(url,params)=>{
  httpCalls++;
  ok(url.startsWith('https://'+host+'/')&&
   ['GET','HEAD'].includes(params.method)&&
   params.redirect==='error'&&params.credentials==='omit'&&
   !params.headers.Authorization,
   'CI HTTPS fixture must use only pinned anonymous GET/HEAD');
  const responseBody=url.endsWith('/health')?
   {status:'ok'}:{status:'ready'};
  const headers={
   'content-type':'application/json',
   'cache-control':'private, no-store',
   'x-content-type-options':'nosniff',
   'strict-transport-security':'max-age=63072000; includeSubDomains'
  };
  return{status:200,url,redirected:false,
   headers:{get:n=>headers[n.toLowerCase()]||null},
   text:async()=>JSON.stringify(responseBody)};
 };
 const https=await createR186HttpsPreflight({
  hostname:host,fetcher:fetchHttp,clock,
  sourceMode:'CI_SYNTHETIC',allowNetwork:true
 }).inspect({commit,bundleSha256:bundle.sha256});
 ok(httpCalls===3&&https.healthAndSecurityPassed===true&&
  https.actualDeploymentAttempted===false&&
  https.externalTlsIdentityIndependentlyAttested===false,
  'exact three mock GET/HEAD check count and no-deployment claims');
 const readHold=async()=>{
  const x=sql('postgres',
   "SELECT h.run_id::text||'|'||h.sequence::text||'|'||h.nonce||'|'||"+
   "h.commit_sha||'|'||h.evidence_sha256||'|'||h.decision||'|'||"+
   "h.production_authorized::text FROM r185_ci.readiness_holds h "+
   "JOIN r185_ci.readiness_audit a ON a.id=h.id "+
   "AND a.evidence_sha256=h.evidence_sha256 WHERE h.id=1").split('|');
  ok(x.length===7&&x[4]===prior.evidenceSha256,
   'real PG17 source-bound R185 audit missing');
  return{runId:Number(x[0]),sequence:Number(x[1]),nonce:x[2],
   sourceCommit:x[3],r185EvidenceSha256:x[4],
   decision:x[5],productionAuthorized:x[6]==='true'};
 };
 const quarantine={status:async()=>{
  const x=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(x.length===2,'source R167 quarantine not readable');
  return{closed:x[0]==='true',generation:Number(x[1])};
 }};
 const assessment=await createR186StagingAssessment({
  readR185Hold:readHold,quarantine,clock,allowInspect:true
 }).inspect({commit,bundleSha256:bundle.sha256,
  r185Report:prev,githubProof:github,httpsProof:https});
 ok(assessment.hardBlockingChecks===5&&
  assessment.checks.every(x=>x.state==='BLOCKED')&&
  assessment.realPilotAuthorized===false&&
  assessment.productionAuthorized===false,
  'CI mock health/approvals cannot establish human staging readiness');
 const ledger=createR186ObservationLedger({
  executeSql:async q=>sql('postgres',q)});
 ok((await ledger.record(assessment)).recorded===true,
  'native PG17 source-bound R186 atomic NO-GO observation not written');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r186_ci.staging_observation_holds)::text||'|'||"+
  "(SELECT count(*) FROM r186_ci.staging_observation_audit)::text||'|'||"+
  "(SELECT count(*) FROM r185_ci.readiness_holds)::text");
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r186_ci.staging_observation_holds'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r186_ci.staging_observation_audit'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r186_ci.staging_observation_holds','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r186_writer','r185_ci.readiness_holds','UPDATE'))::text");
 ok(counts('postgres')==='1|1|1'&&
  roles('postgres')==='true|true|true|true',
  'real PostgreSQL17 R186 audit or FORCE RLS failed');
 let duplicated=false;
 try{await createR186ObservationLedger({
  executeSql:async q=>sql('postgres',q)}).record(assessment);}
 catch{duplicated=true;}
 ok(duplicated,'another native PG17 session replayed R186 decision');
 const dump=cmd('docker',['exec','-u','postgres',env.R186_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.length>512&&dump.subarray(0,5).toString('utf8')==='PGDMP',
  'real PG17 custom-format source snapshot missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r186_restore TEMPLATE template0');
  cmd('docker',['exec','-u','postgres','-i',env.R186_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r186_restore',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 ok(counts('marcosa_r186_restore')==='1|1|1'&&
  roles('marcosa_r186_restore')==='true|true|true|true'&&
  sql('marcosa_r186_restore',
   "SELECT decision FROM r186_ci.staging_observation_holds WHERE id=1")===
    'NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'&&
  sql('marcosa_r186_restore',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true',
  'restored real PG17 lost immutable NO-GO, RLS or quarantine');
 duplicated=false;
 try{await createR186ObservationLedger({
  executeSql:async q=>sql('marcosa_r186_restore',q)
 }).record(assessment);}catch{duplicated=true;}
 ok(duplicated,'restored PG17 accepted a repeated R186 NO-GO');
 const report={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r185Report:prev,githubProof:github,httpsProof:https,
  assessment,assessmentEvidenceSha256:assessment.evidenceSha256,
  realPg17RestoreRlsAndAudit:true,realPg17ReplayDenied:true,
  syntheticGithubApiOnly:true,syntheticHttpsTransportOnly:true,
  realGithubHumanApprovalsVerified:false,
  realHttpsTlsIndependentlyAttested:false,
  realAwsEffectiveRightsVerified:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,reportFile),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R186_REAL_DISPOSABLE_PG17_OBSERVATION_RLS_AND_RESTORE=PASS');
 console.log('R186_SYNTHETIC_GITHUB_AND_HTTPS_API_CONTRACTS=PASS');
 console.log('R186_REAL_GITHUB_HUMANS_TLS_IAM_AND_PILOT=NO_GO');
}
