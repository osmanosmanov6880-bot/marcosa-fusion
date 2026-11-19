/**
 * R185 native two-runner acceptance:
 * - real disposable PG17 R184 source-bound NO-GO; no external credentials
 * - four mock provider read-only provenance receipts, five actionable gaps
 * - deterministic canary, stop & simulated rollback
 * - independent canonical secret-free evidence artifact
 * - one-use SERIALIZABLE FORCE RLS R185 hold + audit
 * - native pg_dump -Fc/pg_restore and replay denial
 * - separate runner with NO DB secrets rehashes source+both artifacts.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR185StagingIntake} from './readiness-intake.mjs';
import {createR185PilotRehearsal,R185_REHEARSAL_PHASES}
 from './pilot-rehearsal.mjs';
import {buildR185SafeEvidence,verifyR185SafeEvidence}
 from './safe-evidence.mjs';
import {createR185PilotGate} from './pilot-gate.mjs';
import {createR185HoldLedger} from './hold-ledger.mjs';
const env=process.env;
const fail=m=>{throw Error('R185 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>sha(Buffer.from(JSON.stringify(x)));
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const reportFile='r185-staging-operator-no-go-report.json';
const safeFile='r185-safe-evidence.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'actual provider secrets, customer DB or OIDC cannot enter CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R185_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R185_PG_CONTAINER,
  'independent runner must not receive database/AWS credentials');
 const root=join(env.RUNNER_TEMP,'r185-second');
 const r=JSON.parse(await readFile(join(root,reportFile),'utf8'));
 const allowed=['schemaVersion','commit','sourceBundleSha256',
  'r184Report','intake','rehearsal',
  'safeEvidenceSha256','safeEvidenceFileSha256',
  'hold','holdEvidenceSha256','realPg17NativeRestoreAndAudit',
  'realPg17RlsAndQuarantineRestored','realPg17ReplayDenied',
  'syntheticProviderEvidenceOnly','syntheticCanaryOnly',
  'realProviderVerified','realProductionRecoveryVerified',
  'realPilotAuthorized','productionAuthorized'].sort().join(',');
 ok(r&&Object.getPrototypeOf(r)===Object.prototype&&
  Object.keys(r).sort().join(',')===allowed&&
  r.schemaVersion===1&&r.commit===commit&&
  r.sourceBundleSha256===bundle.sha256,
  'source-bound exact R185 report schema required');
 const prior=r.r184Report?.pilotProof;
 const {evidenceSha256:priorSha,...priorBody}=prior||{};
 ok(r.r184Report?.commit===commit&&
  r.r184Report?.sourceBundleSha256===bundle.sha256&&
  prior?.sourceCommit===commit&&
  prior.decision==='NO_GO_REAL_STAGING_EVIDENCE_PENDING'&&
  prior.realPilotAuthorized===false&&prior.productionAuthorized===false&&
  H64.test(priorSha||'')&&hash(priorBody)===priorSha,
  'native R184 prior NO-GO or digest altered');
 const i=r.intake,{evidenceSha256:inSha,...inBody}=i||{};
 ok(i?.sourceCommit===commit&&
  i.sourceBundleSha256===bundle.sha256&&
  i.r184EvidenceSha256===priorSha&&
  i.blockedCount===5&&i.blockers?.length===5&&
  i.providerEvidence?.length===4&&
  i.providerEvidence.every(p=>['CI_SYNTHETIC',
   'OPERATOR_READONLY_UNATTESTED'].includes(p.mode))&&
  i.realProviderIndependentlyAttested===false&&
  i.realHumansIndependentlyVerified===false&&
  i.realPilotAuthorized===false&&i.productionAuthorized===false&&
  i.decision==='NO_GO_ACTIONABLE_STAGING_REQUIREMENTS'&&
  H64.test(inSha||'')&&hash(inBody)===inSha,
  'CI synthetic provider information is not independently attested');
 const p=r.rehearsal,{evidenceSha256:reSha,...reBody}=p||{};
 ok(p?.sourceCommit===commit&&
  p.sourceBundleSha256===bundle.sha256&&p.intakeEvidenceSha256===inSha&&
  p.windowsAnalyzed===4&&p.transitions?.length===7&&
  p.failureReason==='NONE'&&p.injection==='NONE'&&
  p.stopped===true&&p.simulatedRollbackVerified===true&&
  p.actualTrafficRouted===false&&p.actualDeploymentAttempted===false&&
  p.realPilotAuthorized===false&&p.productionAuthorized===false&&
  p.decision==='NO_GO_REHEARSAL_COMPLETED'&&
  H64.test(reSha||'')&&hash(reBody)===reSha,
  'rehearsal would be falsely described as real deployment or rollback');
 const packetBytes=await readFile(join(root,safeFile));
 const safe=verifyR185SafeEvidence({bytes:packetBytes,
  commit,bundleSha256:bundle.sha256,
  expectedFileSha256:r.safeEvidenceFileSha256});
 const json=JSON.parse(packetBytes.toString('utf8'));
 ok(safe.verified===true&&r.safeEvidenceSha256===json.evidenceSha256&&
  json.intakeEvidenceSha256===inSha&&
  json.rehearsalEvidenceSha256===reSha&&
  json.r184EvidenceSha256===priorSha&&
  json.requiredBlockingChecks.length===5&&
  json.productionAuthorized===false,
  'independent public-safe artifact does not match original evidence');
 const h=r.hold,{evidenceSha256:holdSha,...holdBody}=h||{};
 ok(h?.sourceCommit===commit&&
  h.sourceBundleSha256===bundle.sha256&&
  h.r184EvidenceSha256===priorSha&&
  h.intakeEvidenceSha256===inSha&&
  h.rehearsalEvidenceSha256===reSha&&
  h.safeEvidenceSha256===json.evidenceSha256&&
  h.safeFileSha256===r.safeEvidenceFileSha256&&
  h.blockingCount===5&&h.syntheticCanaryWindows===4&&
  h.quarantineClosed===true&&
  h.decision==='NO_GO_STAGING_BLOCKERS_UNRESOLVED'&&
  h.realProviderIndependentlyAttested===false&&
  h.realHumanApprovalsVerified===false&&
  h.realProductionRecoveryVerified===false&&
  h.realPilotAuthorized===false&&h.productionAuthorized===false&&
  H64.test(holdSha||'')&&hash(holdBody)===holdSha&&
  r.holdEvidenceSha256===holdSha,
  'independent R185 source-bound hold integrity violated');
 for(const k of ['realPg17NativeRestoreAndAudit',
  'realPg17RlsAndQuarantineRestored','realPg17ReplayDenied',
  'syntheticProviderEvidenceOnly','syntheticCanaryOnly'])
  ok(r[k]===true,'required isolated native PG17 control absent: '+k);
 for(const k of ['realProviderVerified','realProductionRecoveryVerified',
  'realPilotAuthorized','productionAuthorized'])
  ok(r[k]===false,'synthetic CI evidence cannot authorize real pilot');
 console.log('R185_SECOND_RUNNER_SOURCE_AND_PUBLIC_SAFE_SHA=PASS');
 console.log('R185_REAL_PROVIDER_HUMANS_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R185_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'isolated native PG17 and exact CI source required');
 const cmd=(app,args,{input}={})=>{
  const p=spawnSync(app,args,{input,encoding:null,
   timeout:120000,maxBuffer:48*1024*1024});
  ok(!p.error&&p.status===0,
   'disposable native PG17 backup or SQL failed');
  return p.stdout;
 };
 const sql=(db,text)=>cmd('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1',
  '-d',db,'-c',text]).toString('utf8').trim();
 const previous=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r184-paginated-iam-wal-no-go-report.json'),'utf8'));
 const prior=previous.pilotProof,runId=Number(env.GITHUB_RUN_ID);
 ok(previous.schemaVersion===1&&previous.commit===commit&&
  previous.sourceBundleSha256===bundle.sha256&&
  prior?.sourceCommit===commit&&prior.runId===runId&&
  prior.decision==='NO_GO_REAL_STAGING_EVIDENCE_PENDING'&&
  prior.realPilotAuthorized===false&&prior.productionAuthorized===false&&
  previous.realPg17SnapshotExcludedTwentyFour===true&&
  previous.realPg17NativeBackupRestoredNoGoRls===true&&
  previous.realPg17ReplayRejected===true&&
  previous.syntheticGithubReviewPagination===true&&
  previous.syntheticAwsPolicyDenySimulation===true&&
  previous.realGithubHumanApproversVerified===false&&
  previous.realAwsEffectiveRightsVerified===false&&
  previous.realProductionRpoRtoVerified===false&&
  previous.realPilotAuthorized===false&&previous.productionAuthorized===false,
  'real disposable R184 predecessor NO-GO and CI synthetic evidence mandatory');
 const readHold=async()=>{
  const x=sql('postgres',
   "SELECT h.run_id::text||'|'||h.sequence::text||'|'||h.nonce||'|'||"+
   "h.commit_sha||'|'||h.evidence_sha256||'|'||h.decision||'|'||"+
   "h.production_authorized::text FROM r184_ci.pilot_holds h "+
   "JOIN r184_ci.pilot_audit a ON a.id=h.id "+
   "AND a.evidence_sha256=h.evidence_sha256 WHERE h.id=1").split('|');
  ok(x.length===7&&x[4]===prior.evidenceSha256,
   'R184 immutable PG17 source/audit readback changed');
  return{runId:Number(x[0]),sequence:Number(x[1]),nonce:x[2],
   sourceCommit:x[3],r184EvidenceSha256:x[4],
   decision:x[5],productionAuthorized:x[6]==='true'};
 };
 const quarantine={status:async()=>{
  const x=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(x.length===2,'native R167 closed quarantine missing');
  return{closed:x[0]==='true',generation:Number(x[1])};
 }};
 const now=()=>Date.now(),q=await quarantine.status();
 const providers=[
  {kind:'AWS_IDENTITY_AND_S3',
   evidenceSha256:previous.r183Report.r182Report.r181Report.observation.awsEvidenceSha256},
  {kind:'IAM_BOUNDARY_AND_DENY',
   evidenceSha256:previous.iamDenyProof.evidenceSha256},
  {kind:'GITHUB_ENVIRONMENT',
   evidenceSha256:previous.r183Report.r182Report.r181Report.observation.githubEvidenceSha256},
  {kind:'GITHUB_PR_REVIEW',
   evidenceSha256:previous.reviewProof.evidenceSha256}
 ].map(x=>({...x,mode:'CI_SYNTHETIC',
  observedAtMs:now()-1000,expiresAtMs:now()+59000}));
 const intake=createR185StagingIntake({clock:now,
  allowInspect:true}).inspect({
   commit,bundleSha256:bundle.sha256,runId,
   r184EvidenceSha256:prior.evidenceSha256,
   providerEvidence:providers,priorDecision:prior.decision,
   quarantineClosed:q.closed,quarantineGeneration:q.generation,
   disposableRecovery:{mode:'DISPOSABLE_PG17',
    measuredRestoreMs:previous.continuityProof.measuredDisposableRestoreMs,
    syntheticExcludedEvents:24}
  });
 const windows=R185_REHEARSAL_PHASES.map((phase,i)=>({
  phase,requests:1000,errors:1,p95Ms:160+i*15
 }));
 const rehearsal=createR185PilotRehearsal({
  clock:now,allowSynthetic:true}).run({
   commit,bundleSha256:bundle.sha256,runId,
   intakeProof:intake,windows
  });
 const safe=buildR185SafeEvidence({intake,rehearsal});
 ok(verifyR185SafeEvidence({bytes:safe.bytes,
  commit,bundleSha256:bundle.sha256,
  expectedFileSha256:safe.sha256}).verified===true,
  'safe source-bound evidence did not verify locally');
 const hold=await createR185PilotGate({
  readR184Hold:readHold,quarantine,clock:now,allowInspect:true
 }).inspect({
  commit,bundleSha256:bundle.sha256,r184Report:previous,
  intake,rehearsal,safeBytes:safe.bytes,safeFileSha256:safe.sha256
 });
 ok(hold.decision==='NO_GO_STAGING_BLOCKERS_UNRESOLVED'&&
  hold.blockingCount===5&&hold.realPilotAuthorized===false&&
  hold.productionAuthorized===false,
  'native PG17 readiness cannot enable real pilot');
 const ledger=createR185HoldLedger({
  executeSql:async text=>sql('postgres',text)});
 ok((await ledger.record(hold)).recorded===true,
  'native R185 hold and audit INSERT missing');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r185_ci.readiness_holds)::text||'|'||"+
  "(SELECT count(*) FROM r185_ci.readiness_audit)::text||'|'||"+
  "(SELECT count(*) FROM r184_ci.pilot_holds)::text");
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r185_ci.readiness_holds'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r185_ci.readiness_audit'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r185_ci.readiness_holds','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r185_writer','r185_ci.readiness_audit','UPDATE'))::text");
 ok(counts('postgres')==='1|1|1'&&roles('postgres')==='true|true|true|true',
  'real PG17 R185 immutable audit or FORCE RLS missing');
 let replay=false;
 try{await createR185HoldLedger({
  executeSql:async q=>sql('postgres',q)}).record(hold);
 }catch{replay=true;}
 ok(replay,'second native SQL session accepted a duplicated R185 NO-GO');
 const archive=cmd('docker',['exec','-u','postgres',env.R185_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(archive.length>512&&archive.subarray(0,5).toString('utf8')==='PGDMP',
  'native PG17 snapshot missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r185_restored TEMPLATE template0');
  cmd('docker',['exec','-u','postgres','-i',env.R185_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r185_restored',
   '--no-owner','--exit-on-error'],{input:archive});
 }finally{archive.fill(0);}
 ok(counts('marcosa_r185_restored')==='1|1|1'&&
  roles('marcosa_r185_restored')==='true|true|true|true'&&
  sql('marcosa_r185_restored',
   "SELECT decision FROM r185_ci.readiness_holds WHERE id=1")===
   'NO_GO_STAGING_BLOCKERS_UNRESOLVED'&&
  sql('marcosa_r185_restored',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true',
  'native restored PG17 lost R185 NO-GO/RLS/quarantine state');
 replay=false;
 try{await createR185HoldLedger({executeSql:async q=>
  sql('marcosa_r185_restored',q)}).record(hold);
 }catch{replay=true;}
 ok(replay,'restored PG17 admitted duplicate R185 hold');
 await writeFile(join(env.RUNNER_TEMP,safeFile),safe.bytes,
  {flag:'wx',mode:0o600});
 const report={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r184Report:previous,intake,rehearsal,
  safeEvidenceSha256:safe.packet.evidenceSha256,
  safeEvidenceFileSha256:safe.sha256,
  hold,holdEvidenceSha256:hold.evidenceSha256,
  realPg17NativeRestoreAndAudit:true,
  realPg17RlsAndQuarantineRestored:true,realPg17ReplayDenied:true,
  syntheticProviderEvidenceOnly:true,syntheticCanaryOnly:true,
  realProviderVerified:false,realProductionRecoveryVerified:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,reportFile),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R185_NATIVE_POSTGRES17_HOLD_RESTORE_AND_ONE_TIME_AUDIT=PASS');
 console.log('R185_ACTIONABLE_STAGING_REPORT_SAFE_FILE_AND_CANARY_REHEARSAL=PASS');
 console.log('R185_REAL_PROVIDER_HUMANS_RPO_RTO_AND_PRODUCTION=NO_GO');
}
