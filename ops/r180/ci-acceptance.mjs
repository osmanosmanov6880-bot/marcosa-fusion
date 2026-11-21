/**
 * R180 CI acceptance: real isolated PostgreSQL17, synthetic AWS/GitHub
 * upstream evidence, ephemeral two-key Ed25519 NO-GO quorum, true native
 * pg_dump + pg_restore, separate-connection replay denial.
 * All external-provider/human/production fields are FALSE.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {classifyR180Evidence,verifyR180Classification}
 from './evidence-classifier.mjs';
import {issueR180Quorum,verifyR180Quorum,r180SignerPin}
 from './quorum-attestation.mjs';
import {createR180HoldLedger} from './hold-ledger.mjs';
import {createR180HoldGate} from './hold-gate.mjs';
const env=process.env,fail=m=>{throw Error('R180 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const json=x=>JSON.stringify(x);
const sha=x=>createHash('sha256').update(x).digest('hex');
const file='r180-durable-no-go-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'real cloud credentials, OIDC or production account forbidden');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R180_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R180_PG_CONTAINER,
  'second-source runner must not see any database or AWS credentials');
 const artifact=JSON.parse(await readFile(
  join(env.RUNNER_TEMP,'r180-second',file),'utf8'));
 const keys=[
  'schemaVersion','commit','sourceBundleSha256','priorR179Report',
  'classification','quorum','classificationSha256',
  'quorumReceiptSha256','realPg17ImmutableNoGoJournal',
  'realPg17QuarantineClosed','realPg17NativeRestoreAndReplayDenied',
  'twoDistinctEphemeralEd25519Keys','realAwsProviderVerified',
  'realHumanApprovalsVerified','productionAuthorized'
 ].sort().join(',');
 ok(artifact&&Object.getPrototypeOf(artifact)===Object.prototype&&
  Object.keys(artifact).sort().join(',')===keys&&
  artifact.schemaVersion===1&&artifact.commit===commit&&
  artifact.sourceBundleSha256===bundle.sha256&&
  artifact.realPg17ImmutableNoGoJournal===true&&
  artifact.realPg17QuarantineClosed===true&&
  artifact.realPg17NativeRestoreAndReplayDenied===true&&
  artifact.twoDistinctEphemeralEd25519Keys===true&&
  artifact.realAwsProviderVerified===false&&
  artifact.realHumanApprovalsVerified===false&&
  artifact.productionAuthorized===false,
  'exact second-runner NO-GO report source and safety contract required');
 const c=artifact.classification,q=artifact.quorum;
 ok(c?.evidenceSha256===artifact.classificationSha256&&
  q?.receiptSha256===artifact.quorumReceiptSha256&&
  q?.packet?.classificationSha256===c?.evidenceSha256&&
  q?.packet?.reviewEvidenceSha256===c?.reviewEvidenceSha256,
  'quorum not bound to durable R179 evidence classification');
 const rebuilt=classifyR180Evidence(artifact.priorR179Report,{
  commit,bundleSha256:bundle.sha256,
  clock:()=>c.classifiedAtMs
 });
 ok(rebuilt.evidenceSha256===c.evidenceSha256&&
  verifyR180Classification(c,{commit,bundleSha256:bundle.sha256,
   clock:()=>c.classifiedAtMs+1000}).noGo===true,
  'reproduced R179 report did not yield identical SHA-bound blockers');
 const opPin=q?.approvals?.[0]?.spkiSha256,
  auditPin=q?.approvals?.[1]?.spkiSha256;
 const v=verifyR180Quorum(q,{commit,bundleSha256:bundle.sha256,
  classificationSha256:c.evidenceSha256,
  expectedOperatorPin:opPin,expectedAuditorPin:auditPin,
  clock:()=>q.packet.issuedAtMs+1000,historicalRead:true});
 ok(v.verified===true&&v.twoDistinctKeys===true&&
  v.actualHumanApprovalsVerified===false&&
  v.productionAuthorized===false,
  'offline independent Ed25519 review of NO-GO denied');
 console.log('R180_SECOND_RUNNER_REBUILT_REPORT_DUAL_ED25519_NO_GO=PASS');
 console.log('R180_REAL_PROVIDER_HUMANS_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R180_PG_CONTAINER||''),
  'R180 requires real disposable PostgreSQL17 container');
 const run=(cmd,args,{input}={})=>{
  const result=spawnSync(cmd,args,{input,encoding:null,timeout:60000,
   maxBuffer:40*1024*1024});
  ok(result.status===0&&!result.error,'native PG17 operation failed: '+cmd);
  return result.stdout;
 };
 const sql=(db,statement)=>run('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',statement]).toString('utf8').trim();
 const prior=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r179-isolated-review-history-report.json'),'utf8'));
 ok(prior.commit===commit&&
  prior.sourceBundleSha256===bundle.sha256&&
  prior.realPg17ImmutableReviewAndAudit===true&&
  prior.realPg17NativeBackupRestoreAndRls===true&&
  prior.realPg17SeparateProcessReplayDenied===true&&
  prior.actualAwsReplicaVerified===false&&
  prior.actualGitHubReviewersVerified===false&&
  prior.productionAuthorized===false,
  'source R179 native PG17 and synthetic provider report mandatory');
 const clock=()=>Date.now();
 const classification=classifyR180Evidence(prior,{
  commit,bundleSha256:bundle.sha256,clock});
 ok(verifyR180Classification(classification,{
  commit,bundleSha256:bundle.sha256,clock}).noGo,
  'five explicit real infrastructure blockers missing');
 const op=generateKeyPairSync('ed25519');
 const auditor=generateKeyPairSync('ed25519');
 const expectedOperatorPin=r180SignerPin(op.privateKey);
 const expectedAuditorPin=r180SignerPin(auditor.privateKey);
 const quorum=issueR180Quorum({
  classification,operatorPrivateKey:op.privateKey,
  auditorPrivateKey:auditor.privateKey,
  expectedOperatorPin,expectedAuditorPin,clock
 });
 ok(verifyR180Quorum(quorum,{commit,bundleSha256:bundle.sha256,
  classificationSha256:classification.evidenceSha256,
  expectedOperatorPin,expectedAuditorPin,clock}).twoDistinctKeys,
  'two separate ephemeral Ed25519 signatures not valid');
 // No raw signing key is exported or uploaded; only public SPKI + signature.
 const readR179Witness=async()=>{
  const line=sql('postgres',
   "SELECT e.run_id::text||'|'||e.sequence::text||'|'||"+
   "e.nonce||'|'||e.commit_sha||'|'||e.history_root_sha256||'|'||"+
   "e.archive_sha256||'|'||e.restored_state_sha256||'|'||"+
   "e.evidence_sha256||'|'||e.decision||'|'||"+
   "e.production_authorized::text FROM r179_ci.review_evidence e "+
   "JOIN r179_ci.review_audit a ON a.id=e.id AND "+
   "a.evidence_sha256=e.evidence_sha256 WHERE e.id=1");
  const f=line.split('|');
  ok(f.length===10,'native R179 audited source missing');
  return{runId:Number(f[0]),sequence:Number(f[1]),nonce:f[2],
   sourceCommit:f[3],historyRootSha256:f[4],
   archiveSha256:f[5],restoredStateSha256:f[6],
   reviewEvidenceSha256:f[7],decision:f[8],
   productionAuthorized:f[9]==='true'};
 };
 const quarantine={status:async()=>{
  const row=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(row.length===2&&['true','false'].includes(row[0])&&
   Number.isSafeInteger(Number(row[1])),
   'real PostgreSQL source quarantine unavailable');
  return{closed:row[0]==='true',generation:Number(row[1])};
 }};
 let syntheticIncidents=0;
 const circuit={trip:async()=>{
  syntheticIncidents++;return{accepted:true};}};
 const holdLedger=createR180HoldLedger({
  executeSql:async stmt=>sql('postgres',stmt)});
 const readRecordedHold=async()=>{
  const row=sql('postgres',
   "SELECT h.run_id::text||'|'||h.sequence::text||'|'||"+
   "h.nonce||'|'||h.commit_sha||'|'||"+
   "h.classification_sha256||'|'||h.quorum_receipt_sha256||'|'||"+
   "h.decision||'|'||h.production_authorized::text "+
   "FROM r180_ci.holds h JOIN r180_ci.hold_audit a "+
   "ON a.id=h.id AND a.classification_sha256=h.classification_sha256 "+
   "AND a.quorum_receipt_sha256=h.quorum_receipt_sha256 "+
   "WHERE h.id=1").split('|');
  ok(row.length===8,'native append-only hold and audit missing');
  return{runId:Number(row[0]),sequence:Number(row[1]),nonce:row[2],
   sourceCommit:row[3],classificationSha256:row[4],
   quorumReceiptSha256:row[5],decision:row[6],
   productionAuthorized:row[7]==='true'};
 };
 const gate=createR180HoldGate({
  readR179Witness,holdLedger,readRecordedHold,quarantine,
  incidentCircuit:circuit,clock,allowHold:true});
 const result=await gate.record({
  report:prior,classification,quorum,commit,
  bundleSha256:bundle.sha256,
  expectedOperatorPin,expectedAuditorPin});
 ok(result.recordedNoGo===true&&result.blockerCount===5&&
  result.quarantineRemainsClosed===true&&
  result.productionAuthorized===false&&syntheticIncidents===0,
  'durable NO-GO classification or closed source quarantine not verified');
 const rowCounts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r180_ci.holds)::text||'|'||"+
  "(SELECT count(*) FROM r180_ci.hold_audit)::text||'|'||"+
  "(SELECT count(*) FROM r179_ci.review_evidence)::text||'|'||"+
  "(SELECT count(*) FROM r179_ci.review_audit)::text");
 const roles=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r180_ci.holds'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
  "WHERE oid='r180_ci.hold_audit'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r180_ci.holds','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r180_writer','r180_ci.hold_audit','UPDATE'))::text");
 ok(rowCounts('postgres')==='1|1|1|1'&&
  roles('postgres')==='true|true|true|true',
  'real PostgreSQL17 immutable hold/RLS and audit missing');
 let replay=false;
 try{await createR180HoldLedger({
  executeSql:async s=>sql('postgres',s)
 }).record({
  runId:classification.runId,sequence:classification.sequence,
  nonce:classification.nonce,sourceCommit:commit,
  historyRootSha256:classification.historyRootSha256,
  archiveSha256:classification.archiveSha256,
  restoredStateSha256:classification.restoredStateSha256,
  reviewEvidenceSha256:classification.reviewEvidenceSha256,
  classificationSha256:classification.evidenceSha256,
  quorumReceiptSha256:quorum.receiptSha256,operatorPinSha256:expectedOperatorPin,
  auditorPinSha256:expectedAuditorPin,blockerCount:5,
  decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING'
 });}catch{replay=true;}
 ok(replay,'independent PG17 connection could reuse already durable hold');
 const dump=run('docker',['exec','-u','postgres',env.R180_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'actual PG17 custom archive missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r180_restored TEMPLATE template0');
  run('docker',['exec','-u','postgres','-i',env.R180_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r180_restored',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 ok(rowCounts('marcosa_r180_restored')==='1|1|1|1'&&
  roles('marcosa_r180_restored')==='true|true|true|true'&&
  sql('marcosa_r180_restored',
   "SELECT decision FROM r180_ci.holds WHERE id=1")===
   'NO_GO_EXTERNAL_EVIDENCE_PENDING'&&
  sql('marcosa_r180_restored',
   "SELECT closed::text||'|'||generation::text FROM r167_ci.r167_quarantine WHERE id=1").startsWith('true|'),
  'native PG17 restore changed NO-GO, immutable audit, RLS or quarantine');
 replay=false;
 try{await createR180HoldLedger({
  executeSql:async s=>sql('marcosa_r180_restored',s)
 }).record({
  runId:classification.runId,sequence:classification.sequence,
  nonce:classification.nonce,sourceCommit:commit,
  historyRootSha256:classification.historyRootSha256,
  archiveSha256:classification.archiveSha256,
  restoredStateSha256:classification.restoredStateSha256,
  reviewEvidenceSha256:classification.reviewEvidenceSha256,
  classificationSha256:classification.evidenceSha256,
  quorumReceiptSha256:quorum.receiptSha256,
  operatorPinSha256:expectedOperatorPin,auditorPinSha256:expectedAuditorPin,
  blockerCount:5,decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING'
 });}catch{replay=true;}
 ok(replay,'restored PostgreSQL17 accepted replayed NO-GO attestation');
 const artifact={
  schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  priorR179Report:prior,classification,quorum,
  classificationSha256:classification.evidenceSha256,
  quorumReceiptSha256:quorum.receiptSha256,
  realPg17ImmutableNoGoJournal:true,realPg17QuarantineClosed:true,
  realPg17NativeRestoreAndReplayDenied:true,
  twoDistinctEphemeralEd25519Keys:true,
  realAwsProviderVerified:false,realHumanApprovalsVerified:false,
  productionAuthorized:false
 };
 await writeFile(join(env.RUNNER_TEMP,file),
  json(artifact)+'\n',{flag:'wx',mode:0o600});
 console.log('R180_PG17_IMMUTABLE_NO_GO_QUORUM_NATIVE_RESTORE=PASS');
 console.log('R180_R179_INDEPENDENT_REVALIDATION_AND_SOURCE_QUARANTINE=PASS');
 console.log('R180_AWS_HUMAN_PRODUCTION=NO_GO');
}
