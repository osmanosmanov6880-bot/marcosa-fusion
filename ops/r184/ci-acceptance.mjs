/**
 * R184 CI acceptance, exact source:
 * (1) real disposable PostgreSQL 17, inherited immutable R183 NO-GO;
 * (2) synthetic paginated GitHub review history, synthetic IAM simulation;
 * (3) real native pg_dump after 8 events, then 24 real source writes;
 * (4) restore to separate DB with only 8, source has 32, actual WAL grew;
 * (5) append atomic SERIALIZABLE R184 NO-GO and audit, second full restore;
 * (6) credential-free independent runner recomputes SHA/bundle flags.
 * No real AWS/GitHub credentials, customer data or deployment.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR184ReviewHistory} from './review-history.mjs';
import {createR184IamDenyProbe} from './iam-deny-simulation.mjs';
import {createR184ContinuityWindow} from './continuity-window.mjs';
import {createR184PilotReadiness} from './pilot-readiness.mjs';
import {createR184PilotLedger} from './pilot-ledger.mjs';
const env=process.env;
const fail=m=>{throw Error('R184 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hex40=/^[a-f0-9]{40}$/,hex64=/^[a-f0-9]{64}$/;
const artifactFile='r184-paginated-iam-wal-no-go-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 hex40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'R184 forbids real AWS credentials, OIDC or production in CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R184_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R184_PG_CONTAINER,
  'second verifier must be credential-free');
 const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r184-second',artifactFile),'utf8'));
 const keys=['schemaVersion','commit','sourceBundleSha256','r183Report',
  'reviewProof','iamDenyProof','continuityProof','pilotProof',
  'pilotEvidenceSha256','realPg17SnapshotExcludedTwentyFour',
  'realPg17NativeBackupRestoredNoGoRls',
  'realPg17ReplayRejected','syntheticGithubReviewPagination',
  'syntheticAwsPolicyDenySimulation',
  'realGithubHumanApproversVerified',
  'realAwsEffectiveRightsVerified','realProductionRpoRtoVerified',
  'realPilotAuthorized','productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===keys&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256,
  'exact R184 source bundle and independent report keys required');
 const previous=report.r183Report?.pilotProof;
 const {evidenceSha256:priorSha,...prior}=previous||{};
 ok(report.r183Report?.commit===commit&&
  report.r183Report?.sourceBundleSha256===bundle.sha256&&
  previous?.decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
  previous.productionAuthorized===false&&
  previous.realPilotAuthorized===false&&sha(prior)===priorSha,
  'R183 immutable source or synthetic-only provenance altered');
 const review=report.reviewProof;
 const {evidenceSha256:reviewSha,...reviewRaw}=review||{};
 ok(review?.commit===commit&&review.pageCount===2&&
  review.reviewEventCount===120&&
  review.reviewers?.length===2&&
  review.completeHeadReviewHistoryInspected===true&&
  review.externalProviderIdentityIndependentlyAuthenticated===false&&
  review.independentNaturalHumanIdentityVerified===false&&
  review.productionAuthorized===false&&
  sha(reviewRaw)===reviewSha,
  'synthetic full PR review history or rehash invalid');
 const iam=report.iamDenyProof;
 const {evidenceSha256:iamSha,...iamRaw}=iam||{};
 ok(iam?.commit===commit&&iam.bundleSha256===bundle.sha256&&
  iam.totalForbiddenWriteActionsChecked===20&&
  iam.source?.forbiddenWritesSimulated===10&&
  iam.offsite?.forbiddenWritesSimulated===10&&
  iam.allSimulatedWriteActionsDenied===true&&
  iam.actualEffectiveIamRightsVerified===false&&
  iam.externalProviderIndependentlyAttested===false&&
  iam.productionAuthorized===false&&sha(iamRaw)===iamSha,
  'IAM simulated denial must never become real effective permission evidence');
 const continuity=report.continuityProof;
 const {evidenceSha256:continuitySha,...window}=continuity||{};
 ok(continuity?.sourceCommit===commit&&
  continuity?.sourceBundleSha256===bundle.sha256&&
  continuity.r183EvidenceSha256===priorSha&&
  continuity.sourceEventCount===32&&
  continuity.restoredSnapshotEventCount===8&&
  continuity.intentionallyExcludedPostSnapshotEvents===24&&
  continuity.observedSourcePostSnapshotWalBytes>0&&
  continuity.realProductionRpoRtoVerified===false&&
  continuity.realProductionEventsExamined===false&&
  continuity.productionAuthorized===false&&
  sha(window)===continuitySha,
  'disposable PG17 postbackup continuity evidence modified or promoted');
 const pilot=report.pilotProof;
 const {evidenceSha256:pilotSha,...pilotRaw}=pilot||{};
 ok(pilot?.sourceCommit===commit&&
  pilot.sourceBundleSha256===bundle.sha256&&
  pilot.r183EvidenceSha256===priorSha&&
  pilot.reviewHistoryEvidenceSha256===reviewSha&&
  pilot.iamDenyEvidenceSha256===iamSha&&
  pilot.continuityEvidenceSha256===continuitySha&&
  pilot.intentionallyMissingEvents===24&&
  pilot.decision==='NO_GO_REAL_STAGING_EVIDENCE_PENDING'&&
  pilot.sourceMode==='CI_SYNTHETIC'&&
  pilot.realIamEffectivePermissionsVerified===false&&
  pilot.realGithubHumanApprovalsVerified===false&&
  pilot.realProductionRpoRtoVerified===false&&
  pilot.realPilotAuthorized===false&&
  pilot.productionAuthorized===false&&
  sha(pilotRaw)===pilotSha&&
  report.pilotEvidenceSha256===pilotSha,
  'independent R184 pilot NO-GO hashes and source chain mismatched');
 for(const key of ['realPg17SnapshotExcludedTwentyFour',
  'realPg17NativeBackupRestoredNoGoRls','realPg17ReplayRejected',
  'syntheticGithubReviewPagination','syntheticAwsPolicyDenySimulation'])
  ok(report[key]===true,'required real PG17 or simulated CI test absent: '+key);
 for(const key of ['realGithubHumanApproversVerified',
  'realAwsEffectiveRightsVerified','realProductionRpoRtoVerified',
  'realPilotAuthorized','productionAuthorized'])
  ok(report[key]===false,'false provider/live pilot/production approval');
 console.log('R184_SECOND_RUNNER_SOURCE_SHA_AND_NO_GO=PASS');
 console.log('R184_REAL_IAM_HUMANS_PRODUCTION_RPO_RTO_AND_PILOT=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R184_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'real disposable PostgreSQL17 and exact CI run mandatory');
 const command=(program,args,{input}={})=>{
  const r=spawnSync(program,args,{input,encoding:null,
   timeout:120000,maxBuffer:48*1024*1024});
  ok(r.status===0&&!r.error,
   'native PG17 command or isolated restore failed: '+program);
  return r.stdout;
 };
 const sql=(db,q)=>command('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',q]).toString('utf8').trim();
 const r183Report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r183-synthetic-pilot-no-go-delta-evidence.json'),'utf8'));
 const runId=Number(env.GITHUB_RUN_ID),prior=r183Report.pilotProof;
 ok(r183Report.schemaVersion===1&&r183Report.commit===commit&&
  r183Report.sourceBundleSha256===bundle.sha256&&
  prior.runId===runId&&prior.sourceCommit===commit&&
  prior.decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
  prior.realPilotAuthorized===false&&
  prior.productionAuthorized===false&&
  r183Report.realPg17DeltaSnapshotRestored===true&&
  r183Report.realPg17NoGoAndRlsRestored===true&&
  r183Report.realPg17ReplayDenied===true&&
  r183Report.syntheticAwsBoundaryDocuments===true&&
  r183Report.syntheticGithubPrReviewEvents===true&&
  r183Report.realAwsRightsVerified===false&&
  r183Report.realPrReviewersVerified===false&&
  r183Report.realProductionRpoRtoVerified===false&&
  r183Report.productionAuthorized===false,
  'requires true R183 native PG17 NO-GO and mock provider inputs');
 const clock=()=>Date.now();
 const prRepo={full_name:'osmanosmanov6880-bot/marcosa-fusion'};
 const reviewers=[2002,3003];
 const fakeEvents=Array.from({length:98},(_,i)=>({
  id:i+1,user:{id:4001+i,type:'User'},
  commit_id:commit,state:'COMMENTED',
  submitted_at:new Date(clock()-400).toISOString()
 }));
 fakeEvents.push(...reviewers.map((id,i)=>({
  id:999+i,user:{id,type:'User'},
  commit_id:commit,state:'APPROVED',
  submitted_at:new Date(clock()-300+i*20).toISOString()
 })));
 fakeEvents.push(...Array.from({length:20},(_,i)=>({
  id:3000+i,user:{id:5500+i,type:'User'},commit_id:commit,
  state:'COMMENTED',submitted_at:new Date(clock()-50).toISOString()
 })));
 let ghCalls=0;
 const ghFetch=async(url,options)=>{
  ghCalls++;
  ok(options.method==='GET'&&url.startsWith(
   'https://api.github.com/repos/osmanosmanov6880-bot/marcosa-fusion/'),
   'fixture only emulates exact GitHub PR GET');
  const now=clock(),page=/page=(\d+)$/.exec(url);
  const data=page?fakeEvents.slice((Number(page[1])-1)*100,Number(page[1])*100):
   url.includes('/commits/')?{sha:commit,
    commit:{committer:{date:new Date(now-2000).toISOString()},
     verification:{verified:true}}}:
   {number:168,state:'open',draft:false,
    user:{id:1001,type:'User'},
    head:{sha:commit,ref:'feature/marcosa-r150-growth-economics',
     repo:prRepo},
    base:{ref:'feature/series-pilot-r149',repo:prRepo}};
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(data)};
 };
 const review=await createR184ReviewHistory({
  fetcher:ghFetch,token:'ci-synthetic-r184-github-token',
  commit,reviewerIds:reviewers,clock,allowNetwork:true
 }).inspect();
 ok(ghCalls===4&&review.pageCount===2&&
  review.reviewEventCount===120&&review.productionAuthorized===false,
  'two fully inspected synthetic PR review pages required');
 const source={profile:'r184_source_ci',region:'eu-west-1',
  accountId:'111122223333',bucket:'marcosa-source-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
 const offsite={profile:'r184_offsite_ci',region:'eu-central-1',
  accountId:'444455556666',bucket:'marcosa-offsite-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
 let iamCalls=0;
 const mockIam=async({profile,service,operation,params})=>{
  iamCalls++;
  ok(service==='iam'&&operation==='simulate-principal-policy',
   'no IAM mutations or unknown AWS service allowed');
  const t=profile===source.profile?source:profile===offsite.profile?offsite:null;
  ok(t&&params.PolicySourceArn==='arn:aws:iam::'+t.accountId+
   ':role/marcosa-r178-readonly-auditor',
   'synthetic IAM role scope unknown');
  return{json:{IsTruncated:false,EvaluationResults:[{
   EvalActionName:params.ActionNames,
   EvalResourceName:params.ResourceArns,
   EvalDecision:'implicitDeny',MissingContextValues:[],
   ResourceSpecificResults:[]
  }]}};
 };
 const iamDeny=await createR184IamDenyProbe({
  source,offsite,executeAws:mockIam,clock,allowNetwork:true
 }).inspect({commit,bundleSha256:bundle.sha256,
  iamProof:r183Report.r182Report.iamProof,
  boundaryProof:r183Report.boundaryProof});
 ok(iamCalls===20&&iamDeny.allSimulatedWriteActionsDenied===true&&
  iamDeny.actualEffectiveIamRightsVerified===false,
  'all 20 simulated IAM write-denials required');
 const readR183=async db=>{
  ok(['postgres','marcosa_r184_snapshot'].includes(db),
   'native R183 source inspection outside disposable databases forbidden');
  const row=sql(db,
   "SELECT h.run_id::text||'|'||h.sequence::text||'|'||h.nonce||'|'||"+
   "h.commit_sha||'|'||h.evidence_sha256||'|'||h.decision||'|'||"+
   "h.production_authorized::text||'|'||"+
   "(SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class "+
   "WHERE oid='r183_ci.pilot_holds'::regclass) "+
   "FROM r183_ci.pilot_holds h JOIN r183_ci.pilot_audit a "+
   "ON a.id=h.id AND a.evidence_sha256=h.evidence_sha256 WHERE h.id=1"
  ).split('|');
  ok(row.length===8&&row[4]===prior.evidenceSha256,
   'immutable R183 source or native RLS corrupted');
  return{runId:Number(row[0]),sequence:Number(row[1]),nonce:row[2],
   sourceCommit:row[3],r183EvidenceSha256:row[4],decision:row[5],
   productionAuthorized:row[6]==='true',rlsEnforced:row[7]==='true'};
 };
 const quarantine={status:async()=>{
  const v=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(v.length===2,'source quarantine native PG17 readback unavailable');
  return{closed:v[0]==='true',generation:Number(v[1])};
 }};
 const readEvents=async db=>{
  ok(['postgres','marcosa_r184_snapshot','marcosa_r184_final'].includes(db),
   'non-disposable event source refused');
  const rows=sql(db,
   "SELECT ordinal::text||'|'||event_sha256 FROM "+
   "r184_ci.synthetic_continuity_events ORDER BY ordinal");
  return rows.split(/\r?\n/).filter(Boolean).map(line=>{
   const fields=line.split('|');
   ok(fields.length===2&&/^[0-9]{1,2}$/.test(fields[0])&&
    hex64.test(fields[1]),'native continuity event row incomplete');
   return{ordinal:Number(fields[0]),sha256:fields[1]};
  });
 };
 const writeEvents=async(rows,stage,scope)=>{
  ok(scope.commit===commit&&scope.runId===runId&&
   ((stage==='BASELINE'&&rows.length===8)||
    (stage==='AFTER_SNAPSHOT'&&rows.length===24)),
   'only fixed source synthetic event windows may be inserted');
  const tuple=rows.map(r=>{
   ok(Number.isSafeInteger(r.ordinal)&&r.ordinal>=1&&r.ordinal<=32&&
    hex64.test(r.sha256),'trusted deterministic synthetic row only');
   return '('+r.ordinal+",'"+stage+"','"+r.sha256+
    "','"+commit+"',"+runId+')';
  }).join(',');
  const count=sql('postgres',
   "WITH written AS (INSERT INTO r184_ci.synthetic_continuity_events("+
   "ordinal,phase,event_sha256,commit_sha,run_id) VALUES "+tuple+
   " RETURNING ordinal) SELECT count(*)::text FROM written");
  ok(count===String(rows.length),
   'real PostgreSQL inserted a different number of synthetic WAL events');
 };
 const readWalPosition=async()=>sql('postgres',
  'SELECT pg_current_wal_lsn()::text');
 const readWalGrowth=async base=>{
  ok(/^[0-9A-F]+\/[0-9A-F]+$/.test(base),
   'native PG17 WAL starting position malformed');
  return Number(sql('postgres',
   "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),'"+
   base+"'::pg_lsn)::bigint::text"));
 };
 const continuity=await createR184ContinuityWindow({
  readR183Witness:readR183,readQuarantine:quarantine.status,
  readEvents,writeEvents,readWalPosition,readWalGrowth,
  dumpSource:async()=>command('docker',['exec','-u','postgres',
   env.R184_PG_CONTAINER,'pg_dump','-U','postgres','-d','postgres','-Fc']),
  restoreToIsolated:async({database,bytes,expectedCommit,
   expectedSourceSha256})=>{
   ok(database==='marcosa_r184_snapshot'&&expectedCommit===commit&&
    expectedSourceSha256===prior.evidenceSha256,
    'must restore only into exact isolated R184 postgres database');
   sql('postgres','CREATE DATABASE marcosa_r184_snapshot TEMPLATE template0');
   command('docker',['exec','-u','postgres','-i',env.R184_PG_CONTAINER,
    'pg_restore','-U','postgres','-d',database,
    '--no-owner','--exit-on-error'],{input:bytes});
  },clock,allowDisposableRestore:true
 }).inspect({commit,bundleSha256:bundle.sha256,runId,maxRestoreMs:120000});
 ok(continuity.sourceEventCount===32&&
  continuity.restoredSnapshotEventCount===8&&
  continuity.intentionallyExcludedPostSnapshotEvents===24&&
  continuity.realProductionRpoRtoVerified===false,
  'real isolated R184 native window not verified');
 const readGate=async()=>{
  const{rlsEnforced,...w}=await readR183('postgres');
  ok(rlsEnforced===true,'R183 native PostgreSQL FORCE RLS weakened');
  return w;
 };
 const hold=await createR184PilotReadiness({
  readR183Hold:readGate,quarantine,clock,allowInspect:true
 }).inspect({r183Report,reviewProof:review,iamDenyProof:iamDeny,
  continuityProof:continuity,commit,bundleSha256:bundle.sha256});
 ok(hold.decision==='NO_GO_REAL_STAGING_EVIDENCE_PENDING'&&
  hold.realPilotAuthorized===false&&hold.productionAuthorized===false,
  'R184 source-bound hold may not grant real pilot');
 const ledger=createR184PilotLedger({
  executeSql:async q=>sql('postgres',q)});
 ok((await ledger.record(hold)).recorded===true,
  'native immutable R184 NO-GO and audit write missing');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r184_ci.pilot_holds)::text||'|'||"+
  "(SELECT count(*) FROM r184_ci.pilot_audit)::text||'|'||"+
  "(SELECT count(*) FROM r183_ci.pilot_holds)::text||'|'||"+
  "(SELECT count(*) FROM r184_ci.synthetic_continuity_events)::text");
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r184_ci.pilot_holds'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r184_ci.pilot_audit'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r184_ci.synthetic_continuity_events'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r184_ci.pilot_holds','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r184_writer','r183_ci.pilot_holds','UPDATE'))::text");
 ok(counts('postgres')==='1|1|1|32'&&
  roles('postgres')==='true|true|true|true|true',
  'real PG17 R184 source/audit/event RLS counts missing');
 let duplicate=false;
 try{await createR184PilotLedger({executeSql:async q=>
  sql('postgres',q)}).record(hold);}catch{duplicate=true;}
 ok(duplicate,'independent native PG17 session re-used hold');
 const archive=command('docker',['exec','-u','postgres',env.R184_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(archive.length>=512&&archive.subarray(0,5).toString('utf8')==='PGDMP',
  'R184 second native custom archive missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r184_final TEMPLATE template0');
  command('docker',['exec','-u','postgres','-i',env.R184_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r184_final',
   '--no-owner','--exit-on-error'],{input:archive});
 }finally{archive.fill(0);}
 ok(counts('marcosa_r184_final')==='1|1|1|32'&&
  roles('marcosa_r184_final')==='true|true|true|true|true'&&
  sql('marcosa_r184_final',
   "SELECT decision FROM r184_ci.pilot_holds WHERE id=1")===
   'NO_GO_REAL_STAGING_EVIDENCE_PENDING'&&
  sql('marcosa_r184_final',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true'&&
  (await readEvents('marcosa_r184_final')).length===32,
  'restored real PostgreSQL17 R184 RLS, event count or NO-GO corrupted');
 duplicate=false;
 try{await createR184PilotLedger({executeSql:async q=>
  sql('marcosa_r184_final',q)}).record(hold);}catch{duplicate=true;}
 ok(duplicate,'restored PostgreSQL17 replayed immutable R184 hold');
 const artifact={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r183Report,reviewProof:review,iamDenyProof:iamDeny,
  continuityProof:continuity,pilotProof:hold,
  pilotEvidenceSha256:hold.evidenceSha256,
  realPg17SnapshotExcludedTwentyFour:true,
  realPg17NativeBackupRestoredNoGoRls:true,
  realPg17ReplayRejected:true,
  syntheticGithubReviewPagination:true,
  syntheticAwsPolicyDenySimulation:true,
  realGithubHumanApproversVerified:false,
  realAwsEffectiveRightsVerified:false,
  realProductionRpoRtoVerified:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,artifactFile),
  JSON.stringify(artifact,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R184_NATIVE_PG17_SNAPSHOT_8_PLUS_24_AND_RESTORED_NO_GO=PASS');
 console.log('R184_SYNTHETIC_FULL_GITHUB_REVIEW_AND_20_IAM_DENIALS=PASS');
 console.log('R184_REAL_PILOT_CLOUD_HUMANS_PRODUCTION_RPO_RTO=NO_GO');
}
