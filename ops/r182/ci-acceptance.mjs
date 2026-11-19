/**
 * R182 technical acceptance: REAL disposable PostgreSQL17 with measured
 * custom-format restore, exact R181 prior evidence, IAM API fixture and
 * SOURCE-BOUND NO-GO. Independent runner rehashes public report, not
 * AWS humans/identities/effective rights. No live credentials or writes.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {buildR178ReadOnlyIamBlueprint} from '../r178/iam-plan.mjs';
import {createR182IamPostureAudit} from './iam-posture.mjs';
import {createR182RecoveryDrill} from './restore-drill.mjs';
import {createR182ReadinessBarrier} from './readiness-evidence.mjs';
import {createR182ReadinessLedger} from './readiness-ledger.mjs';
const env=process.env;
const fail=m=>{throw Error('R182 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const hashObj=x=>sha(Buffer.from(JSON.stringify(x)));
const hashCanon=x=>hashObj(canon(x));
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const filename='r182-provider-iam-disposable-restore-no-go.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 H40.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'real AWS/GitHub tokens, OIDC or customer PostgreSQL forbidden in CI');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
if(env.R182_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD&&!env.R182_PG_CONTAINER,
  'independent report verifier must be credentials-free');
 const report=JSON.parse(await readFile(
  join(env.RUNNER_TEMP,'r182-second',filename),'utf8'));
 const names=['schemaVersion','commit','sourceBundleSha256',
  'r181Report','iamProof','drillProof','readinessProof',
  'readinessEvidenceSha256','realPg17TwoNativeRestores',
  'realPg17RlsAndNoGoAuditParity',
  'realPg17RestoredDbReplayDenied',
  'syntheticIamApiObservations',
  'realIamRightsIndependentlyVerified',
  'realProductionRpoRtoVerified',
  'realGithubApproversVerified','productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===names&&
  report.schemaVersion===1&&report.commit===commit&&
  report.sourceBundleSha256===bundle.sha256,
  'source checkout, report version or complete schema mismatched');
 const prior=report.r181Report,p=prior?.observation;
 const {evidenceSha256:priorSha,...priorBody}=p||{};
 ok(prior?.commit===commit&&
  prior.sourceBundleSha256===bundle.sha256&&
  p?.sourceMode==='CI_SYNTHETIC'&&p.productionAuthorized===false&&
  p.actualIndependentProviderAttestation===false&&
  hashObj(priorBody)===priorSha,
  'R181 synthetic provenance or SHA was altered');
 const {evidenceSha256:iamSha,...iamRaw}=report.iamProof||{};
 ok(report.iamProof?.commit===commit&&
  report.iamProof?.bundleSha256===bundle.sha256&&
  report.iamProof.exactTwoRoleReadOnlyShapeMatched===true&&
  report.iamProof.effectiveIamRightsIndependentlyVerified===false&&
  report.iamProof.permissionsBoundaryPolicyContentInspected===false&&
  report.iamProof.productionAuthorized===false&&
  hashCanon(iamRaw)===iamSha,
  'IAM policy receipt elevated, mutated or not canonical');
 const d=report.drillProof;
 const {evidenceSha256:drillSha,...drillRaw}=d||{};
 ok(d?.scope==='disposable-postgres17-only'&&
  d.sourceCommit===commit&&d.sourceBundleSha256===bundle.sha256&&
  d.r181EvidenceSha256===priorSha&&
  Number.isSafeInteger(d.measuredRestoreMs)&&
  d.measuredRestoreMs>=1&&
  d.measuredRestoreMs<=d.configuredTestBudgetMs&&
  d.observedFrozenSnapshotLossMs===0&&
  d.realProductionRpoRtoMeasured===false&&
  d.productionAuthorized===false&&
  hashObj(drillRaw)===drillSha,
  'measured disposable restore was forged or promoted');
 const e=report.readinessProof;
 const {evidenceSha256:resultSha,...readiness}=e||{};
 ok(e?.schemaVersion===1&&
  e.scope==='synthetic-provider-disposable-pg17-readiness'&&
  e.decision==='NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
  e.sourceCommit===commit&&
  e.sourceBundleSha256===bundle.sha256&&
  e.r181EvidenceSha256===priorSha&&
  e.iamEvidenceSha256===iamSha&&
  e.recoveryDrillEvidenceSha256===drillSha&&
  e.isolatedMeasuredRestoreMs===d.measuredRestoreMs&&
  e.closedQuarantineVerified===true&&
  ['realIamPermissionBoundaryIndependentlyAttested',
   'actualGithubHumanApprovalsIndependentlyAttested',
   'realProductionRpoRtoVerified','realS3DeliveryIndependentlyVerified',
   'productionAuthorized'].every(k=>e[k]===false)&&
  H64.test(resultSha||'')&&
  report.readinessEvidenceSha256===resultSha&&
  hashObj(readiness)===resultSha,
  'independent source and read-only NO-GO attestation failed');
 for(const k of ['realPg17TwoNativeRestores',
  'realPg17RlsAndNoGoAuditParity','realPg17RestoredDbReplayDenied',
  'syntheticIamApiObservations'])ok(report[k]===true,
  'CI evidence claim missing: '+k);
 for(const k of ['realIamRightsIndependentlyVerified',
  'realProductionRpoRtoVerified','realGithubApproversVerified',
  'productionAuthorized'])ok(report[k]===false,
  'CI must never promote synthetic/provider results');
 console.log('R182_SECOND_RUNNER_SOURCE_AND_NO_GO_SHA=PASS');
 console.log('R182_REAL_IAM_HUMANS_AND_PRODUCTION_RPO_RTO=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R182_PG_CONTAINER||'')&&
  /^\d{5,20}$/.test(env.GITHUB_RUN_ID||''),
  'only real disposable PG17 CI container supported');
 const command=(name,args,{input}={})=>{
  const r=spawnSync(name,args,{input,encoding:null,
   timeout:120000,maxBuffer:45*1024*1024});
  ok(r.status===0&&!r.error,
   'isolated native command failed: '+name+' '+args.slice(0,2).join(' '));
  return r.stdout;
 };
 const sql=(db,q)=>command('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1',
  '-d',db,'-c',q]).toString('utf8').trim();
 const old=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r181-readonly-observation-report.json'),'utf8'));
 ok(old.schemaVersion===1&&old.commit===commit&&
  old.sourceBundleSha256===bundle.sha256&&
  old.realPg17OneTimeReadOnlyObservation===true&&
  old.realPg17RlsAndQuarantineRestored===true&&
  old.realPg17CrossSessionReplayRejected===true&&
  old.syntheticGithubEnvironmentAndApprovals===true&&
  old.syntheticAwsProfilesAndFullEncryptedGet===true&&
  old.realAwsProvidersIndependentlyAttested===false&&
  old.realHumanReviewersVerified===false&&
  old.productionAuthorized===false,
  'R181 native PG17 with CI-synthetic providers prerequisite missing');
 const runId=Number(env.GITHUB_RUN_ID);
 const raw=old.observation;
 const oldRow=sql('postgres',
  "SELECT o.run_id::text||'|'||o.sequence::text||'|'||o.nonce||'|'||"+
  "o.commit_sha||'|'||o.evidence_sha256||'|'||"+
  "h.classification_sha256||'|'||h.quorum_receipt_sha256||'|'||"+
  "h.decision||'|'||o.decision||'|'||"+
  "(SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1)||'|'||"+
  "(SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class "+
  " WHERE oid='r181_ci.observations'::regclass)||'|'||"+
  "o.production_authorized::text FROM r181_ci.observations o "+
  "JOIN r181_ci.observation_audit a ON a.id=o.id AND "+
  "a.evidence_sha256=o.evidence_sha256 "+
  "JOIN r180_ci.holds h ON h.id=o.id WHERE o.id=1").split('|');
 ok(oldRow.length===12&&Number(oldRow[0])===runId&&
  raw?.evidenceSha256===oldRow[4]&&raw.sourceCommit===commit,
  'real PG17 R180/R181 initial source proof incorrect');
 const readSnapshot=async(db)=>{
  const r=sql(db,
   "SELECT o.run_id::text||'|'||o.sequence::text||'|'||o.nonce||'|'||"+
   "o.commit_sha||'|'||o.evidence_sha256||'|'||"+
   "h.classification_sha256||'|'||h.quorum_receipt_sha256||'|'||"+
   "h.decision||'|'||o.decision||'|'||"+
   "(SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1)||'|'||"+
   "(SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class "+
   " WHERE oid='r181_ci.observations'::regclass)||'|'||"+
   "o.production_authorized::text FROM r181_ci.observations o "+
   "JOIN r181_ci.observation_audit a ON a.id=o.id AND "+
   "a.evidence_sha256=o.evidence_sha256 "+
   "JOIN r180_ci.holds h ON h.id=o.id WHERE o.id=1").split('|');
  ok(r.length===12,'native R181 source/restore audit read missing');
  return{runId:Number(r[0]),sequence:Number(r[1]),nonce:r[2],
   sourceCommit:r[3],r181EvidenceSha256:r[4],
   r180ClassificationSha256:r[5],r180QuorumReceiptSha256:r[6],
   holdDecision:r[7],observationDecision:r[8],
   quarantineClosed:r[9]==='true',rlsEnforced:r[10]==='true',
   productionAuthorized:r[11]==='true'};
 };
 const quarantine={status:async()=>{const r=sql('postgres',
   "SELECT closed::text||'|'||generation::text "+
   "FROM r167_ci.r167_quarantine WHERE id=1").split('|');
  ok(r.length===2,'R167 original quarantine missing');
  return{closed:r[0]==='true',generation:Number(r[1])};
 }};
 const source={profile:'source_ci',region:'eu-west-1',
  accountId:'111122223333',bucket:'marcosa-source-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
 const offsite={profile:'offsite_ci',region:'eu-central-1',
  accountId:'444455556666',bucket:'marcosa-offsite-r178-ci',
  kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
 const blueprint=buildR178ReadOnlyIamBlueprint({source,offsite});
 let iamCalls=0;
 const executeAws=async({profile,service,operation,params})=>{
  iamCalls++;ok(service==='iam'&&params.RoleName==='marcosa-r178-readonly-auditor',
   'injected IAM fixture must use only pinned read-only role');
  const i=profile===source.profile?0:profile===offsite.profile?1:-1;
  ok(i!==-1,'IAM fixture attempted unknown profile');
  const expected=blueprint.plans[i];
  switch(operation){
   case 'get-role':return{json:{Role:{
    Arn:expected.roleArn,RoleName:'marcosa-r178-readonly-auditor',
    MaxSessionDuration:3600,
    PermissionsBoundary:{PermissionsBoundaryArn:
     'arn:aws:iam::'+expected.accountId+':policy/marcosa-staging-readonly-boundary'},
    AssumeRolePolicyDocument:expected.trustPolicy}}};
   case 'list-role-policies':return{json:{IsTruncated:false,
    PolicyNames:['marcosa-r182-staging-readonly']}};
   case 'list-attached-role-policies':return{json:{
    IsTruncated:false,AttachedPolicies:[]}};
   case 'get-role-policy':return{json:{
    RoleName:'marcosa-r178-readonly-auditor',
    PolicyName:'marcosa-r182-staging-readonly',
    PolicyDocument:expected.permissionsPolicy}};
   default:fail('unexpected or mutating IAM operation');
  }
 };
 const clock=()=>Date.now();
 const iam=await createR182IamPostureAudit({
  source,offsite,executeAws,clock,allowNetwork:true
 }).inspect({commit,bundleSha256:bundle.sha256});
 ok(iamCalls===8&&iam.productionAuthorized===false&&
  iam.effectiveIamRightsIndependentlyVerified===false,
  'all 2x4 synthetic IAM read-only queries required');
 const drill=await createR182RecoveryDrill({
  readSource:async()=>readSnapshot('postgres'),
  readQuarantine:quarantine.status,
  dumpSource:async()=>command('docker',['exec','-u','postgres',
   env.R182_PG_CONTAINER,'pg_dump','-U','postgres','-d','postgres','-Fc']),
  restoreToIsolated:async({database,bytes})=>{
   ok(database==='marcosa_r182_drill'&&Buffer.isBuffer(bytes),
    'restore must use preapproved disposable target');
   sql('postgres','CREATE DATABASE marcosa_r182_drill TEMPLATE template0');
   command('docker',['exec','-u','postgres','-i',
    env.R182_PG_CONTAINER,'pg_restore','-U','postgres','-d',database,
    '--no-owner','--exit-on-error'],{input:bytes});
  },
  readRestored:async db=>readSnapshot(db),
  clock,allowDisposableRestore:true
 }).inspect({commit,bundleSha256:bundle.sha256,runId,maxRtoMs:120000});
 const readWitness=async()=>{
  const x=sql('postgres',
   "SELECT o.run_id::text||'|'||o.sequence::text||'|'||o.nonce||'|'||"+
   "o.commit_sha||'|'||o.evidence_sha256||'|'||"+
   "h.classification_sha256||'|'||h.quorum_receipt_sha256||'|'||"+
   "o.decision||'|'||o.production_authorized::text "+
   "FROM r181_ci.observations o JOIN r181_ci.observation_audit a "+
   "ON a.id=o.id AND a.evidence_sha256=o.evidence_sha256 "+
   "JOIN r180_ci.holds h ON h.id=o.id WHERE o.id=1").split('|');
  ok(x.length===9,'native R181 high-water missing after isolated restore');
  return{runId:Number(x[0]),sequence:Number(x[1]),nonce:x[2],
   sourceCommit:x[3],r181EvidenceSha256:x[4],
   r180ClassificationSha256:x[5],r180QuorumReceiptSha256:x[6],
   decision:x[7],productionAuthorized:x[8]==='true'};
 };
 const readiness=await createR182ReadinessBarrier({
  readR181Witness:readWitness,quarantine,clock,allowInspect:true
 }).inspect({r181Report:old,iamProof:iam,drillProof:drill,
  commit,bundleSha256:bundle.sha256});
 ok(readiness.decision==='NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
  readiness.productionAuthorized===false&&
  readiness.isolatedMeasuredRestoreMs===drill.measuredRestoreMs,
  'native R181 source changed or staged NO-GO promoted');
 const ledger=createR182ReadinessLedger({
  executeSql:async q=>sql('postgres',q)});
 ok((await ledger.record(readiness)).recorded===true,
  'native PG17 R182 immutable admission not recorded');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r182_ci.recovery_readiness)::text||'|'||"+
  "(SELECT count(*) FROM r182_ci.readiness_audit)::text||'|'||"+
  "(SELECT count(*) FROM r181_ci.observations)::text||'|'||"+
  "(SELECT count(*) FROM r180_ci.holds)::text");
 const rls=db=>sql(db,
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity "+
  "FROM pg_class WHERE oid='r182_ci.recovery_readiness'::regclass)::text||'|'||"+
  "(SELECT relrowsecurity AND relforcerowsecurity "+
  "FROM pg_class WHERE oid='r182_ci.readiness_audit'::regclass)::text||'|'||"+
  "(NOT has_table_privilege('authenticated','r182_ci.recovery_readiness','SELECT'))::text||'|'||"+
  "(NOT has_table_privilege('marcosa_r182_writer','r182_ci.readiness_audit','UPDATE'))::text");
 ok(counts('postgres')==='1|1|1|1'&&
  rls('postgres')==='true|true|true|true',
  'real PG17 R182 immutable RLS/source/audit parity missing');
 let replay=false;
 try{await createR182ReadinessLedger({
  executeSql:async q=>sql('postgres',q)
 }).record(readiness);}catch{replay=true;}
 ok(replay,'separate native session reinserted R182 readiness');
 const second=command('docker',['exec','-u','postgres',env.R182_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(second.subarray(0,5).toString('utf8')==='PGDMP'&&second.length>512,
  'second verified immutable custom archive missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r182_recovered TEMPLATE template0');
  command('docker',['exec','-u','postgres','-i',env.R182_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r182_recovered',
   '--no-owner','--exit-on-error'],{input:second});
 }finally{second.fill(0);}
 ok(counts('marcosa_r182_recovered')==='1|1|1|1'&&
  rls('marcosa_r182_recovered')==='true|true|true|true'&&
  sql('marcosa_r182_recovered',
   "SELECT decision FROM r182_ci.recovery_readiness WHERE id=1")===
    'NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
  sql('marcosa_r182_recovered',
   "SELECT closed::text FROM r167_ci.r167_quarantine WHERE id=1")==='true',
  'second native PG17 restore lost immutable NO-GO, RLS or quarantine');
 replay=false;
 try{await createR182ReadinessLedger({executeSql:async q=>
  sql('marcosa_r182_recovered',q)}).record(readiness);}catch{replay=true;}
 ok(replay,'restored real PostgreSQL17 accepted duplicated R182 evidence');
 const report={schemaVersion:1,commit,sourceBundleSha256:bundle.sha256,
  r181Report:old,iamProof:iam,drillProof:drill,
  readinessProof:readiness,readinessEvidenceSha256:readiness.evidenceSha256,
  realPg17TwoNativeRestores:true,realPg17RlsAndNoGoAuditParity:true,
  realPg17RestoredDbReplayDenied:true,syntheticIamApiObservations:true,
  realIamRightsIndependentlyVerified:false,
  realProductionRpoRtoVerified:false,realGithubApproversVerified:false,
  productionAuthorized:false};
 await writeFile(join(env.RUNNER_TEMP,filename),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R182_REAL_DISPOSABLE_PG17_TWO_NATIVE_RESTORES_AND_RLS=PASS');
 console.log('R182_SYNTHETIC_TWO_IAM_ROLES_AND_OIDC_TRUST=PASS');
 console.log('R182_REAL_IAM_HUMAN_RPO_RTO_AND_PRODUCTION=NO_GO');
}
