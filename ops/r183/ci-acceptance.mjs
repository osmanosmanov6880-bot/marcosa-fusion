/**
 * R183 technical CI acceptance:
 * - real disposable PostgreSQL17 R182 source & FORCE RLS
 * - mock read-only AWS IAM permission boundary and mock GitHub PR reviews
 * - native PG17 baseline -> pg_dump -> synthetic late write -> restore
 * - source-bound one-time PG17 R183 NO-GO hold + audit and replay rejection
 * - second independent native PG17 restore, independent runner rehash
 *
 * NEVER real AWS/GitHub attestation, staging deploy, or production RPO/RTO.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {buildR178ReadOnlyIamBlueprint} from '../r178/iam-plan.mjs';
import {createR183BoundaryAudit} from './boundary-policy.mjs';
import {createR183PrReviewAudit} from './github-pr-review.mjs';
import {createR183DeltaRecovery} from './delta-recovery.mjs';
import {createR183PilotGate} from './pilot-gate.mjs';
import {createR183PilotLedger} from './pilot-ledger.mjs';
const env=process.env;
const fail=m=>{throw Error('R183 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashObj=x=>sha(Buffer.from(JSON.stringify(x)));
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const hashCanon=x=>hashObj(canon(x));
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const file='r183-synthetic-pilot-no-go-delta-evidence.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'production AWS, client secrets or OIDC credentials not permitted in CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R183_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R183_PG_CONTAINER,
  'second runner may not have PostgreSQL credentials');
 const report=JSON.parse(await readFile(
  join(env.RUNNER_TEMP,'r183-second',file),'utf8'));
 const keys=[
  'schemaVersion','commit','sourceBundleSha256','r182Report',
  'boundaryProof','prReviewProof','deltaProof','pilotProof',
  'pilotEvidenceSha256','realPg17DeltaSnapshotRestored',
  'realPg17NoGoAndRlsRestored','realPg17ReplayDenied',
  'syntheticAwsBoundaryDocuments','syntheticGithubPrReviewEvents',
  'realAwsRightsVerified','realPrReviewersVerified',
  'realProductionRpoRtoVerified','realPilotAuthorized',
  'productionAuthorized'
 ].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===keys&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256,
  'exact R183 independent source and report contract required');
 const prior=report.r182Report;
 const {evidenceSha256:priorSha,...priorRaw}=prior?.readinessProof||{};
 ok(prior?.commit===commit&&prior?.sourceBundleSha256===bundle.sha256&&
  prior.realPg17TwoNativeRestores===true&&
  prior.syntheticIamApiObservations===true&&
  prior.productionAuthorized===false&&
  prior.readinessProof?.decision==='NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
  prior.readinessProof.productionAuthorized===false&&
  hashObj(priorRaw)===priorSha,
  'R182 prior source evidence cannot be promoted');
 const b=report.boundaryProof;
 const {evidenceSha256:boundarySha,...boundaryRaw}=b||{};
 ok(b?.commit===commit&&b.bundleSha256===bundle.sha256&&
  b.twoDefaultBoundaryPolicyDocumentsMatched===true&&
  b.iamEffectivePermissionsIndependentlyVerified===false&&
  b.organizationScpAndResourcePoliciesVerified===false&&
  b.productionAuthorized===false&&
  hashCanon(boundaryRaw)===boundarySha&&
  boundarySha===report.pilotProof?.boundaryEvidenceSha256,
  'IAM boundary proof source, canonical SHA or NO-GO mismatched');
 const pr=report.prReviewProof;
 const {evidenceSha256:reviewSha,...reviewRaw}=pr||{};
 ok(pr?.commit===commit&&pr.pullRequest===168&&
  pr.verifiedCommitSignatureObserved===true&&
  pr.exactTwoHeadPrReviewEventsObserved===true&&
  Array.isArray(pr.reviewers)&&pr.reviewers.length>=2&&
  pr.independentNaturalHumanIdentityVerified===false&&
  pr.approvedToDeploy===false&&pr.productionAuthorized===false&&
  hashObj(reviewRaw)===reviewSha&&
  reviewSha===report.pilotProof?.prReviewEvidenceSha256,
  'CI fake PR review events do not prove real identities');
 const delta=report.deltaProof;
 const {evidenceSha256:deltaSha,...deltaRaw}=delta||{};
 ok(delta?.scope==='disposable-postgres17-synthetic-delta-only'&&
  delta.sourceCommit===commit&&
  delta.sourceBundleSha256===bundle.sha256&&
  delta.r182EvidenceSha256===priorSha&&
  delta.postBackupSourceMarkerCount===2&&
  delta.restoredSnapshotMarkerCount===1&&
  delta.intentionallyMissingPostBackupEvents===1&&
  delta.productionDataLossMeasured===false&&
  delta.realProductionRpoRtoVerified===false&&
  delta.productionAuthorized===false&&hashObj(deltaRaw)===deltaSha&&
  deltaSha===report.pilotProof?.deltaEvidenceSha256,
  'one synthetic postbackup delta gap must not be labelled production loss');
 const p=report.pilotProof;
 const {evidenceSha256:pilotSha,...pilotRaw}=p||{};
 ok(p?.schemaVersion===1&&
  p.scope==='ci-synthetic-pilot-readiness-hold'&&
  p.sourceMode==='CI_SYNTHETIC'&&
  p.decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
  p.sourceCommit===commit&&p.sourceBundleSha256===bundle.sha256&&
  p.r182EvidenceSha256===priorSha&&
  p.syntheticLostDeltaEvents===1&&
  p.isolatedMeasuredRestoreMs===delta.measuredDisposableRestoreMs&&
  p.quarantineRemainsClosed===true&&
  p.realProviderAttestationVerified===false&&
  p.realIndependentHumanApprovalsVerified===false&&
  p.effectiveIamRightsVerified===false&&
  p.productionRpoRtoVerified===false&&
  p.realPilotAuthorized===false&&p.productionAuthorized===false&&
  H64.test(pilotSha||'')&&
  hashObj(pilotRaw)===pilotSha&&
  report.pilotEvidenceSha256===pilotSha,
  'independent runner rejects promoted/tampered R183 pilot hold');
 for(const k of ['realPg17DeltaSnapshotRestored',
  'realPg17NoGoAndRlsRestored','realPg17ReplayDenied',
  'syntheticAwsBoundaryDocuments','syntheticGithubPrReviewEvents'])
  ok(report[k]===true,'missing technical control: '+k);
 for(const k of ['realAwsRightsVerified','realPrReviewersVerified',
  'realProductionRpoRtoVerified','realPilotAuthorized',
  'productionAuthorized'])
  ok(report[k]===false,'synthetic evidence never grants real pilot');
 console.log('R183_SECOND_RUNNER_SOURCE_AND_NO_GO_CHECKSUMS=PASS');
 console.log('R183_REAL_AWS_HUMANS_PRODUCTION_RPO_RTO_AND_PILOT=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R183_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'isolated real PG17 container and source-pinned run required');
 const exec=(name,args,{input}={})=>{
  const r=spawnSync(name,args,{input,encoding:null,
   timeout:120000,maxBuffer:45*1024*1024});
  ok(!r.error&&r.status===0,'native disposable SQL/backup/restore failed');
  return r.stdout;
 };
 const sql=(db,statement)=>exec('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',statement]).toString('utf8').trim();
 const r182Report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r182-provider-iam-disposable-restore-no-go.json'),'utf8'));
 const runId=Number(env.GITHUB_RUN_ID);
 const iam=r182Report.iamProof,prior=r182Report.readinessProof;
 ok(r182Report.schemaVersion===1&&r182Report.commit===commit&&
  r182Report.sourceBundleSha256===bundle.sha256&&
  prior.runId===runId&&prior.sourceCommit===commit&&
  prior.decision==='NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
  r182Report.realPg17TwoNativeRestores===true&&
  r182Report.realPg17RlsAndNoGoAuditParity===true&&
  r182Report.realPg17RestoredDbReplayDenied===true&&
  r182Report.syntheticIamApiObservations===true&&
  r182Report.realIamRightsIndependentlyVerified===false&&
  r182Report.realProductionRpoRtoVerified===false&&
  r182Report.realGithubApproversVerified===false&&
  r182Report.productionAuthorized===false,
  'R182 real PG17 source and only synthetic AWS prerequisite required');
 const clock=()=>Date.now();
 const source={profile:'r183_source_ci',region:'eu-west-1',
  accountId:'111122223333',bucket:'marcosa-source-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
 const offsite={profile:'r183_offsite_ci',region:'eu-central-1',
  accountId:'444455556666',bucket:'marcosa-offsite-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
 const plans=buildR178ReadOnlyIamBlueprint({source,offsite});
 let boundaryCalls=0;
 const executeAws=async({profile,service,operation,params})=>{
  boundaryCalls++;
  ok(service==='iam'&&
   (operation==='get-policy'||operation==='get-policy-version'),
   'only mock IAM boundary read-only calls allowed');
  const i=profile===source.profile?0:profile===offsite.profile?1:-1;
  ok(i!==-1,'unexpected source AWS profile');
  const target=i?offsite:source;
  const arn='arn:aws:iam::'+target.accountId+
   ':policy/marcosa-staging-readonly-boundary';
  ok(params.PolicyArn===arn,'IAM boundary ARN modified');
  if(operation==='get-policy')return{json:{Policy:{
   Arn:arn,DefaultVersionId:'v1',
   IsAttachable:true,AttachmentCount:2
  }}};
  ok(params.VersionId==='v1','wrong immutable IAM default policy version');
  return{json:{PolicyVersion:{VersionId:'v1',IsDefaultVersion:true,
   Document:plans.plans[i].permissionsPolicy}}};
 };
 const boundaryProof=await createR183BoundaryAudit({
  source,offsite,executeAws,clock,allowNetwork:true
 }).inspect({commit,bundleSha256:bundle.sha256,iamProof:iam});
 ok(boundaryCalls===4&&
  boundaryProof.twoDefaultBoundaryPolicyDocumentsMatched===true&&
  boundaryProof.iamEffectivePermissionsIndependentlyVerified===false,
  'two synthetic IAM policy versions must match expected blueprint');
 const reviewers=[2002,3003];
 let githubCalls=0;
 const ghFetcher=async url=>{
  githubCalls++;
  ok(url.startsWith('https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion/'),
   'GitHub fake endpoints must be pinned');
  const repo={full_name:'osmanosmanov6880-bot/marcosa-fusion'};
  const now=clock();
  const result=url.includes('/reviews?')?
   reviewers.map((id,i)=>({id:300+i,user:{id,type:'User'},
    commit_id:commit,state:'APPROVED',
    submitted_at:new Date(now-300).toISOString()})):
   url.includes('/commits/')?{
    sha:commit,verification:{verified:true},
    commit:{committer:{date:new Date(now-1000).toISOString()}}}:
   {number:168,state:'open',draft:false,
    user:{id:1001,type:'User'},
    head:{sha:commit,ref:'feature/marcosa-r150-growth-economics',repo},
    base:{ref:'feature/series-pilot-r149',repo}};
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(result)};
 };
 const prReviewProof=await createR183PrReviewAudit({
  fetcher:ghFetcher,token:'ci-synthetic-gh-r183-token',
  reviewerIds:reviewers,commit,clock,allowNetwork:true
 }).inspect();
 ok(githubCalls===3&&
  prReviewProof.exactTwoHeadPrReviewEventsObserved===true&&
  prReviewProof.independentNaturalHumanIdentityVerified===false,
  'CI review responses are synthetic, never actual people');
 const readSource=async db=>{
  ok(['postgres','marcosa_r183_delta'].includes(db),
   'synthetic source inspection outside allowed databases');
  const row=sql(db,
   "SELECT r.run_id::text||'|'||r.sequence::text||'|'||r.nonce||'|'||"+
   "r.commit_sha||'|'||r.evidence_sha256||'|'||r.decision||'|'||"+
   "r.production_authorized::text||'|'||"+
   "(SELECT (relrowsecurity AND relforcerowsecurity)::text "+
   "FROM pg_class WHERE oid='r182_ci.recovery_readiness'::regclass) "+
   "FROM r182_ci.recovery_readiness r JOIN r182_ci.readiness_audit a "+
   "ON a.id=r.id AND a.evidence_sha256=r.evidence_sha256 WHERE r.id=1").split('|');
  ok(row.length===8&&row[4]===prior.evidenceSha256,
   'native R182 immutable evidence was lost');
  return{runId:Number(row[0]),sequence:Number(row[1]),nonce:row[2],
   sourceCommit:row[3],r182EvidenceSha256:row[4],
   decision:row[5],productionAuthorized:row[6]==='true',
   rlsEnforced:row[7]==='true'};
 };
 const quarantine={status:async()=>{
  const x=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(x.length===2,'native R167 closed quarantine missing');
  return{closed:x[0]==='true',generation:Number(x[1])};
 }};
 const readMarkers=async db=>{
  ok(['postgres','marcosa_r183_delta','marcosa_r183_final'].includes(db),
   'marker database not explicitly allowed');
  const lines=sql(db,
   "SELECT kind||'|'||marker_sha256 FROM r183_ci.synthetic_delta_markers "+
   "ORDER BY ordinal").split(/\r?\n/).filter(Boolean);
  return lines.map(line=>{
   const p=line.split('|');
   ok(p.length===2,'native PG17 marker row invalid');
   return{kind:p[0],sha256:p[1]};
  });
 };
 const quotedHash=h=>{
  ok(H64.test(h),'only bounded lowercase SHA-256 metadata allowed');
  return "'"+h+"'";
 };
 const insertMarker=async(ord,kind,marker,{commit:sourceCommit,runId:run})=>{
  ok(sourceCommit===commit&&run===runId&&
   ['BASELINE','POST_BACKUP'].includes(kind)&&
   ((ord===1&&kind==='BASELINE')||(ord===2&&kind==='POST_BACKUP')),
   'synthetic source marker contract drifted');
  const response=sql('postgres',
   "INSERT INTO r183_ci.synthetic_delta_markers("+
   "ordinal,kind,marker_sha256,commit_sha,run_id) VALUES ("+
   ord+",'"+kind+"',"+quotedHash(marker.sha256)+
   ",'"+commit+"',"+runId+") RETURNING ordinal::text");
  ok(response===String(ord),'real PostgreSQL synthetic marker write failed');
 };
 const deltaProof=await createR183DeltaRecovery({
  readR182Witness:readSource,quarantine,
  writeBaseline:async(x,scope)=>insertMarker(1,'BASELINE',x,scope),
  dumpSource:async()=>exec('docker',['exec','-u','postgres',
   env.R183_PG_CONTAINER,'pg_dump','-U','postgres','-d','postgres','-Fc']),
  writeAfterBackup:async(x,scope)=>insertMarker(2,'POST_BACKUP',x,scope),
  restoreToIsolated:async({database,bytes,expectedRunId,
   expectedSourceSha256})=>{
   ok(database==='marcosa_r183_delta'&&expectedRunId===runId&&
    expectedSourceSha256===prior.evidenceSha256,
    'only disconnected, disposable snapshot restoration target');
   sql('postgres','CREATE DATABASE marcosa_r183_delta TEMPLATE template0');
   exec('docker',['exec','-u','postgres','-i',env.R183_PG_CONTAINER,
    'pg_restore','-U','postgres','-d',database,
    '--no-owner','--exit-on-error'],{input:bytes});
  },
  readMarkers,clock,allowDisposableRestore:true
 }).inspect({commit,bundleSha256:bundle.sha256,runId,maxDurationMs:120000});
 ok(deltaProof.intentionallyMissingPostBackupEvents===1&&
  deltaProof.productionDataLossMeasured===false&&
  deltaProof.productionAuthorized===false,
  'disposable snapshot gap must never be described as real production loss');
 const readGate=async()=>{
  const {rlsEnforced,...w}=await readSource('postgres');
  ok(rlsEnforced===true,'native R182 SOURCE FORCE RLS disabled');
  return w;
 };
 const pilot=await createR183PilotGate({
  readR182Witness:readGate,quarantine,clock,allowInspect:true
 }).inspect({r182Report,boundaryProof,prReviewProof,deltaProof,
  commit,bundleSha256:bundle.sha256});
 ok(pilot.decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
  pilot.syntheticLostDeltaEvents===1&&
  pilot.realPilotAuthorized===false&&pilot.productionAuthorized===false,
  'source-bound R183 must remain immutable NO-GO');
 const ledger=createR183PilotLedger({
  executeSql:async text=>sql('postgres',text)});
 ok((await ledger.record(pilot)).recorded===true,
  'native one-use R183 no-go pilot hold missing');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r183_ci.pilot_holds)::text||'|'||"+
  "(SELECT count(*) FROM r183_ci.pilot_audit)::text||'|'||"+
  "(SELECT count(*) FROM r182_ci.recovery_readiness)::text||'|'||"+
  "(SELECT count(*) FROM r183_ci.synthetic_delta_markers)::text");
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r183_ci.pilot_holds'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r183_ci.pilot_audit'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r183_ci.synthetic_delta_markers'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r183_ci.pilot_holds','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r183_writer','r183_ci.pilot_audit','UPDATE'))::text");
 ok(counts('postgres')==='1|1|1|2'&&
  roles('postgres')==='true|true|true|true|true',
  'native PG17 R183 audit/RLS/synthetic delta markers not preserved');
 let replay=false;
 try{await createR183PilotLedger({
  executeSql:async q=>sql('postgres',q)
 }).record(pilot);}catch{replay=true;}
 ok(replay,'separate PG17 session reused a signed NO-GO hold');
 const finalDump=exec('docker',['exec','-u','postgres',env.R183_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(finalDump.length>512&&
  finalDump.subarray(0,5).toString('utf8')==='PGDMP',
  'final native R183 custom backup missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r183_final TEMPLATE template0');
  exec('docker',['exec','-u','postgres','-i',env.R183_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r183_final',
   '--no-owner','--exit-on-error'],{input:finalDump});
 }finally{finalDump.fill(0);}
 ok(counts('marcosa_r183_final')==='1|1|1|2'&&
  roles('marcosa_r183_final')==='true|true|true|true|true'&&
  sql('marcosa_r183_final',
   "SELECT decision FROM r183_ci.pilot_holds WHERE id=1")===
   'NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
  sql('marcosa_r183_final',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true',
  'native final restore lost append-only NO-GO or quarantine');
 replay=false;
 try{await createR183PilotLedger({
  executeSql:async q=>sql('marcosa_r183_final',q)
 }).record(pilot);}catch{replay=true;}
 ok(replay,'restored PostgreSQL17 accepted duplicate pilot hold');
 const artifact={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r182Report,boundaryProof,prReviewProof,deltaProof,
  pilotProof:pilot,pilotEvidenceSha256:pilot.evidenceSha256,
  realPg17DeltaSnapshotRestored:true,
  realPg17NoGoAndRlsRestored:true,realPg17ReplayDenied:true,
  syntheticAwsBoundaryDocuments:true,
  syntheticGithubPrReviewEvents:true,
  realAwsRightsVerified:false,realPrReviewersVerified:false,
  realProductionRpoRtoVerified:false,realPilotAuthorized:false,
  productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,file),
  JSON.stringify(artifact,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R183_NATIVE_PG17_DELTA_AND_IMMUTABLE_HOLD_RESTORE=PASS');
 console.log('R183_SYNTHETIC_TWO_IAM_BOUNDARIES_AND_GITHUB_PR_REVIEWS=PASS');
 console.log('R183_REAL_PILOT_HUMANS_AWS_RPO_RTO_AND_PRODUCTION=NO_GO');
}
