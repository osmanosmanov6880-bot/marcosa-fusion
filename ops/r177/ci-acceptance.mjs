/**
 * R177 independent, credential-free GitHub Actions acceptance.
 * Native disposable PostgreSQL17 restores and R174-R177 RLS are real.
 * AWS S3, reviewer keys, KMS, STS and all external responses are synthetic.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR174ArchiveCheckpoint} from '../r174/archive-checkpoint.mjs';
import {r174RecoveryEvidenceDigest} from '../r174/recovery-admission.mjs';
import {issueR175DualAnchor} from '../r175/dual-anchor.mjs';
import {createR175OffsiteAnchorStore} from '../r175/anchor-store.mjs';
import {createR175RecoveryNonce} from '../r175/recovery-nonce.mjs';
import {createR176OffsiteChainReader} from '../r176/offsite-chain.mjs';
import {createR176RecoveryFence} from '../r176/recovery-fence.mjs';
import {createR177AnchorWitness} from './anchor-witness.mjs';
import {createR177OffsiteReconciler,r177HistoryDigest}
 from './offsite-reconcile.mjs';
import {createR177RestoreOutcomeStore} from './restore-outcome.mjs';
const env=process.env,fail=m=>{throw Error('R177 native CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const H64=/^[a-f0-9]{64}$/;
const name='r177-isolated-native-history-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'real AWS, GitHub OIDC, production credentials and local runs denied');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const witnessDigest=data=>sha(Buffer.from(JSON.stringify({
 schemaVersion:1,scope:'R177_NATIVE_DISPOSABLE_PG17',...data,
 productionAuthorized:false
})));
if(env.R177_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,
  'independent source verifier must have no PostgreSQL credentials');
 const result=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r177-second',name),'utf8'));
 const fields=['schemaVersion','commit','sourceBundleSha256',
  'historyRootSha256','restoredStateSha256','restoredStateWitness',
  'realPg17HistoricalJournalAndRls','realPg17CurrentHighwaterAndNonce',
  'realPg17FreshArchiveReplayRejected',
  'realPg17NativeRestoreAndPrivacyParity',
  'realPg17AppendOnlyOutcomeAfterRestore',
  'realPg17SecondDumpRestoresAuditAndPreventsReplay',
  'syntheticS3ThreeExactVersionReadbacks',
  'twoSyntheticEd25519KeysDistinct',
  'realAwsAccountsUsed','realHumansVerified',
  'productionRpoRtoProven','productionAuthorized'].sort().join(',');
 ok(result&&Object.getPrototypeOf(result)===Object.prototype&&
  Object.keys(result).sort().join(',')===fields&&
  result.schemaVersion===1&&result.commit===commit&&
  result.sourceBundleSha256===bundle.sha256&&
  H64.test(result.historyRootSha256||'')&&
  H64.test(result.restoredStateSha256||'')&&
  result.restoredStateSha256===witnessDigest(result.restoredStateWitness),
  'nonsecret independent source-bound PG17 witness was altered');
 const v=result.restoredStateWitness;
 ok(v&&Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).sort().join(',')===
   ['anchorAuditRows','anchorRows','inactiveSessions',
   'latestSequence','outcomeAuditRowsBeforeCommit',
   'outcomeRowsBeforeCommit','r175LeaseRows','r176AdmissionRows',
   'rootRows','rowSecurityTables','syntheticEpisodes'].sort().join(',')&&
  v.anchorAuditRows===3&&v.anchorRows===3&&v.inactiveSessions===1&&
  v.latestSequence===3&&v.outcomeAuditRowsBeforeCommit===0&&
  v.outcomeRowsBeforeCommit===0&&v.r175LeaseRows===2&&
  v.r176AdmissionRows===2&&v.rootRows===1&&
  v.rowSecurityTables===5&&v.syntheticEpisodes===3,
  'restore inventory does not represent expected synthetic PG17 state');
 for(const key of ['realPg17HistoricalJournalAndRls',
  'realPg17CurrentHighwaterAndNonce','realPg17FreshArchiveReplayRejected',
  'realPg17NativeRestoreAndPrivacyParity',
  'realPg17AppendOnlyOutcomeAfterRestore',
  'realPg17SecondDumpRestoresAuditAndPreventsReplay',
  'syntheticS3ThreeExactVersionReadbacks',
  'twoSyntheticEd25519KeysDistinct'])
  ok(result[key]===true,'primary disposable check missing: '+key);
 for(const key of ['realAwsAccountsUsed','realHumansVerified',
  'productionRpoRtoProven','productionAuthorized'])
  ok(result[key]===false,'simulated evidence cannot authorize production');
 console.log('R177_SECOND_RUNNER_EXACT_SOURCE_AND_EVIDENCE=PASS');
 console.log('R177_EXTERNAL_AWS_AND_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R177_PG_CONTAINER||''),
  'actual disposable PostgreSQL 17 container missing');
 const run=(exe,args,{input}={})=>{
  const result=spawnSync(exe,args,{encoding:null,input,timeout:60000,
   maxBuffer:40*1024*1024});
  ok(result.status===0&&!result.error,'native command failure: '+exe);
  return result.stdout;
 };
 const sql=(db,q)=>run('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',db,'-c',q]).toString('utf8').trim();
 const old=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r176-isolated-offsite-chain-report.json'),'utf8'));
 ok(old.commit===commit&&old.bundleSha256===bundle.sha256&&
  old.realPg17NativeRestoreRetainedBothGates===true&&
  old.realPg17SecondAuditRls===true&&old.productionAuthorized===false,
  'R176 native isolated recovery and immutable source evidence required');
 const original=sql('postgres',
  "SELECT sequence::text||'|'||source_commit||'|'||archive_sha256||'|'||escrow_sha256||'|'||evidence_sha256||'|'||archived_at_ms::text FROM r174_ci.checkpoint WHERE id=1");
 const [oldSeq,oldCommit,oldArchive,oldEscrow,oldEvidence,oldArchived]=
  original.split('|');
 ok(Number(oldSeq)===2&&oldCommit===commit&&
  [oldArchive,oldEscrow,oldEvidence].every(x=>H64.test(x))&&
  Number.isSafeInteger(Number(oldArchived)),
  'genuine R174 sequence-2 high-water missing');
 const archiveSha256=randomBytes(32).toString('hex');
 const escrowSha256=randomBytes(32).toString('hex');
 const archivedAtMs=Math.max(Date.now()-1000,Number(oldArchived)+1);
 const kms='arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab';
 const sequence=3;
 const checkpointSha256=r174RecoveryEvidenceDigest({sequence,commit,
  bundleSha256:bundle.sha256,archiveSha256,escrowSha256,
  offsiteKmsArn:kms,archivedAtMs});
 const advanced=await createR174ArchiveCheckpoint({
  executeSql:async s=>sql('postgres',s)
 }).advance({expectedSequence:2,sequence,commit,archiveSha256,
  escrowSha256,evidenceSha256:checkpointSha256,archivedAtMs});
 ok(advanced.monotonicCheckpointAccepted,
  'new real PG17 source archive sequence 3 not committed');
 const high=()=>{
  const r=sql('postgres',
   "SELECT sequence::text||'|'||source_commit||'|'||archive_sha256||'|'||escrow_sha256||'|'||evidence_sha256||'|'||production_authorized::text FROM r174_ci.checkpoint WHERE id=1").split('|');
  return{sequence:Number(r[0]),source_commit:r[1],
   archive_sha256:r[2],escrow_sha256:r[3],
   evidence_sha256:r[4],production_authorized:r[5]==='true'};
 };
 const checkpoints=sql('postgres',
  "SELECT sequence::text||'|'||archive_sha256||'|'||evidence_sha256 FROM r174_ci.checkpoint_events ORDER BY sequence")
  .split('\n').map(x=>x.split('|'));
 ok(checkpoints.length===3&&checkpoints.every((x,i)=>Number(x[0])===i+1),
  'real PG17 archive sequence predecessor events absent');
 const now=Date.now(),clock=()=>now;
 const op=generateKeyPairSync('ed25519');
 const reviewer=generateKeyPairSync('ed25519');
 const raw=[];const receipts=[];
 for(let i=0;i<3;i++){
  const info={sequence:i+1,commit,bundleSha256:bundle.sha256,
   archiveSha256:checkpoints[i][1],
   escrowSha256:i===2?escrowSha256:randomBytes(32).toString('hex'),
   checkpointSha256:checkpoints[i][2],
   priorAnchorSha256:i===0?'0'.repeat(64):receipts.at(-1).anchorSha256};
  const receipt=issueR175DualAnchor({data:info,
   operatorKey:op.privateKey,reviewerKey:reviewer.privateKey,clock});
  raw.push(info);receipts.push(receipt);
 }
 const operatorPin=receipts[0].approvals[0].signerSpkiSha256;
 const reviewerPin=receipts[0].approvals[1].signerSpkiSha256;
 ok(operatorPin!==reviewerPin&&raw[2].checkpointSha256===checkpointSha256,
  'actual R174 checkpoint and two ephemeral signing keys mismatch');
 // Real AWS SDK v3 shapes with fully injected (non-network) S3 responses.
 const sdk=createRequire(new URL('../r170/package.json',import.meta.url));
 const S3=sdk('@aws-sdk/client-s3');
 const storage=new Map();
 const accountId='444455556666',bucket='marcosa-offsite-r177-ci';
 let s3Calls=0;
 const client={send:async command=>{
  s3Calls++;
  const i=command.input;
  ok(i.ExpectedBucketOwner===accountId&&i.Bucket===bucket,
   'synthetic offsite identity replaced');
  if(command instanceof S3.PutObjectCommand){
   ok(i.IfNoneMatch==='*'&&!storage.has(i.Key)&&
    i.ObjectLockMode==='COMPLIANCE',
    'offsite anchor overwrite or Object Lock downgrade');
   const v={...i,Body:Buffer.from(i.Body),
    VersionId:'r177-offsite-v'+(storage.size+1)};
   storage.set(i.Key,v);
   return{VersionId:v.VersionId};
  }
  const v=storage.get(i.Key);
  ok(v&&v.VersionId===i.VersionId,'unpinned offsite version');
  if(command instanceof S3.HeadObjectCommand)return{
   VersionId:v.VersionId,ContentLength:v.ContentLength,
   ContentType:v.ContentType,ServerSideEncryption:v.ServerSideEncryption,
   SSEKMSKeyId:v.SSEKMSKeyId,ObjectLockMode:v.ObjectLockMode,
   ObjectLockRetainUntilDate:v.ObjectLockRetainUntilDate,
   ChecksumSHA256:v.ChecksumSHA256};
  if(command instanceof S3.GetObjectCommand)return{
   VersionId:v.VersionId,ContentLength:v.ContentLength,Body:Buffer.from(v.Body)};
  throw Error('unsupported synthetic S3 command');
 }};
 const anchorStore=createR175OffsiteAnchorStore({client,commands:S3,
  bucket,accountId,kmsKeyArn:kms,
  pinnedOperatorSpkiSha256:operatorPin,
  pinnedReviewerSpkiSha256:reviewerPin,clock,allowExternalCalls:true});
 const locators=[];
 for(let i=0;i<3;i++){
  const saved=await anchorStore.save({receipt:receipts[i],expected:raw[i]});
  ok(saved.immutableVersionChecked===true,'S3 HEAD writeback missing');
  locators.push({sha256:saved.sha256,versionId:saved.versionId,
   expected:raw[i]});
 }
 const chainReader=createR176OffsiteChainReader({
  anchorStore,pinnedOperatorSpkiSha256:operatorPin,
  pinnedReviewerSpkiSha256:reviewerPin,clock,allowRead:true});
 const readWitnesses=db=>{
  const q="SELECT COALESCE(json_agg(json_build_object("+
   "'sequence',sequence,'sourceCommit',btrim(source_commit),"+
   "'archiveSha256',btrim(archive_sha256),"+
   "'checkpointSha256',btrim(checkpoint_sha256),"+
   "'anchorSha256',btrim(anchor_sha256),"+
   "'objectSha256',btrim(object_sha256),"+
   "'versionId',version_id,"+
   "'priorAnchorSha256',btrim(prior_anchor_sha256))"+
   " ORDER BY sequence)::text,'[]') FROM r177_ci.anchors";
  return JSON.parse(sql(db,q));
 };
 const incidents=[];
 const circuit={snapshot:()=>({stopped:true}),trip:async x=>{
  incidents.push(x);return{accepted:true};}};
 const reconciler=createR177OffsiteReconciler({
  readCheckpoint:async()=>high(),chainReader,
  witnessStore:createR177AnchorWitness({
   executeSql:async s=>sql('postgres',s)}),
  readWitnesses:async()=>readWitnesses('postgres'),
  incidentCircuit:circuit,allowReconcile:true
 });
 const reconciled=await reconciler.reconcile({locators,
  bundleSha256:bundle.sha256,
  pinnedOperatorSpkiSha256:operatorPin,
  pinnedReviewerSpkiSha256:reviewerPin});
 ok(reconciled.verified===true&&
  reconciled.anchorCount===3&&incidents.length===0&&s3Calls>=12&&
  reconciled.rootSha256===r177HistoryDigest(readWitnesses('postgres')),
  'actual R174 history and versioned S3 synthetic HEAD/full GET not reconciled');
 const nonce=randomBytes(16).toString('hex');
 const newest={nonce,sequence,commit,archiveSha256,
  checkpointSha256,anchorSha256:locators[2].sha256};
 const nonceStore=createR175RecoveryNonce({
  executeSql:async s=>sql('postgres',s)});
 const secondStore=createR176RecoveryFence({
  executeSql:async s=>sql('postgres',s)});
 ok((await nonceStore.consume(newest)).consumedExactlyOnce,
  'new PG17 high-water nonce not durable');
 ok((await secondStore.admit(newest)).admittedExactlyOnce,
  'new PG17 second one-use admission not durable');
 let replayDenied=false;
 try{await createR175RecoveryNonce({
  executeSql:async s=>sql('postgres',s)
 }).consume({...newest,nonce:randomBytes(16).toString('hex')});}
 catch{replayDenied=true;}
 ok(replayDenied,'fresh nonce could reuse same sequence and bypass R175 fence');
 replayDenied=false;
 try{await createR176RecoveryFence({
  executeSql:async s=>sql('postgres',s)
 }).admit(newest);}catch{replayDenied=true;}
 ok(replayDenied,'PG17 second audit accepted replayed sequence');
 const stats=db=>{
  const parts=sql(db,
   "SELECT (SELECT count(*) FROM r177_ci.anchors)::text||'|'||"+
   "(SELECT count(*) FROM r177_ci.anchor_audit)::text||'|'||"+
   "(SELECT count(*) FROM r177_ci.roots)::text||'|'||"+
   "(SELECT count(*) FROM r175_ci.recovery_leases)::text||'|'||"+
   "(SELECT count(*) FROM r176_ci.admissions)::text||'|'||"+
   "(SELECT count(*) FROM r177_ci.outcomes)::text||'|'||"+
   "(SELECT count(*) FROM r177_ci.outcome_audit)::text||'|'||"+
   "(SELECT count(*) FROM r167_ci.r167_sessions WHERE active=false)::text||'|'||"+
   "(SELECT count(*) FROM public.r167_episodes)::text").split('|').map(Number);
  ok(parts.length===9&&parts.every(Number.isSafeInteger),
   'PG17 restored synthetic counts missing');
  return parts;
 };
 const flags=db=>sql(db,
  "SELECT count(*) FROM pg_class WHERE oid IN ("+
  "'r177_ci.anchors'::regclass,'r177_ci.anchor_audit'::regclass,"+
  "'r177_ci.roots'::regclass,'r177_ci.outcomes'::regclass,"+
  "'r177_ci.outcome_audit'::regclass) AND relrowsecurity AND relforcerowsecurity");
 ok(flags('postgres')==='5'&&
  sql('postgres',
   "SELECT (NOT has_table_privilege('authenticated','r177_ci.anchors','SELECT'))::text||'|'||(NOT has_table_privilege('marcosa_r177_writer','r177_ci.outcomes','UPDATE'))::text")==='true|true',
  'source R177 FORCE RLS or browser privilege boundary broken');
 const dump=run('docker',['exec','-u','postgres',env.R177_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'native PG17 custom dump absent');
 try{
  sql('postgres','CREATE DATABASE marcosa_r177_restored TEMPLATE template0');
  run('docker',['exec','-u','postgres','-i',env.R177_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r177_restored',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 const measured=stats('marcosa_r177_restored');
 ok(measured.join('|')==='3|3|1|2|2|0|0|1|3'&&
  flags('marcosa_r177_restored')==='5'&&
  r177HistoryDigest(readWitnesses('marcosa_r177_restored'))===
   reconciled.rootSha256,
  'actual PG17 restored high-water/history/RLS/privacy did not survive');
 let restoredReplayDenied=false;
 try{await createR176RecoveryFence({
  executeSql:async s=>sql('marcosa_r177_restored',s)
 }).admit(newest);}catch{restoredReplayDenied=true;}
 ok(restoredReplayDenied,'restored database accepted consumed sequence');
 const restoredStateWitness={
  latestSequence:Number(sql('marcosa_r177_restored',
   'SELECT sequence FROM r174_ci.checkpoint WHERE id=1')),
  anchorRows:measured[0],anchorAuditRows:measured[1],
  rootRows:measured[2],r175LeaseRows:measured[3],
  r176AdmissionRows:measured[4],
  outcomeRowsBeforeCommit:measured[5],
  outcomeAuditRowsBeforeCommit:measured[6],
  inactiveSessions:measured[7],syntheticEpisodes:measured[8],
  rowSecurityTables:5
 };
 const restoredStateSha256=witnessDigest(restoredStateWitness);
 const outcomeInput={nonce,sequence,
  rootSha256:reconciled.rootSha256,restoredStateSha256,
  archiveSha256,checkpointSha256,
  objectSha256:locators[2].sha256,sourceCommit:commit};
 const outcomeStore=createR177RestoreOutcomeStore({
  executeSql:async s=>sql('postgres',s)});
 ok((await outcomeStore.record(outcomeInput)).recorded,
  'durable readback-bound PG17 outcome missing');
 let outcomeReplayDenied=false;
 try{await createR177RestoreOutcomeStore({
  executeSql:async s=>sql('postgres',s)
 }).record(outcomeInput);}catch{outcomeReplayDenied=true;}
 ok(outcomeReplayDenied,'PostgreSQL duplicated successful restore outcome');
 ok(stats('postgres').join('|')==='3|3|1|2|2|1|1|1|3',
  'original PostgreSQL outcome or append-only audit mismatch');
 const latestDump=run('docker',['exec','-u','postgres',env.R177_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(latestDump.subarray(0,5).toString('utf8')==='PGDMP',
  'second source backup not native PG17 custom format');
 try{
  sql('postgres','CREATE DATABASE marcosa_r177_final TEMPLATE template0');
  run('docker',['exec','-u','postgres','-i',env.R177_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r177_final',
   '--no-owner','--exit-on-error'],{input:latestDump});
 }finally{latestDump.fill(0);}
 ok(stats('marcosa_r177_final').join('|')==='3|3|1|2|2|1|1|1|3'&&
  flags('marcosa_r177_final')==='5'&&
  r177HistoryDigest(readWitnesses('marcosa_r177_final'))===
   reconciled.rootSha256,
  'second PG17 native restore lost immutable audit, RLS or source history');
 let finalReplayDenied=false;
 try{await createR177RestoreOutcomeStore({
  executeSql:async s=>sql('marcosa_r177_final',s)
 }).record(outcomeInput);}catch{finalReplayDenied=true;}
 ok(finalReplayDenied,'restored PG17 accepted old success-audit replay');
 const result={schemaVersion:1,commit,
  sourceBundleSha256:bundle.sha256,
  historyRootSha256:reconciled.rootSha256,
  restoredStateSha256,restoredStateWitness,
  realPg17HistoricalJournalAndRls:true,
  realPg17CurrentHighwaterAndNonce:true,
  realPg17FreshArchiveReplayRejected:true,
  realPg17NativeRestoreAndPrivacyParity:true,
  realPg17AppendOnlyOutcomeAfterRestore:true,
  realPg17SecondDumpRestoresAuditAndPreventsReplay:true,
  syntheticS3ThreeExactVersionReadbacks:true,
  twoSyntheticEd25519KeysDistinct:true,
  realAwsAccountsUsed:false,realHumansVerified:false,
  productionRpoRtoProven:false,productionAuthorized:false};
 await writeFile(join(env.RUNNER_TEMP,name),
  JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R177_REAL_PG17_SIGNED_HISTORY_AND_TWO_NATIVE_RESTORES=PASS');
 console.log('R177_REAL_PG17_IMMUTABLE_OUTCOME_AND_RLS=PASS');
 console.log('R177_REAL_EXTERNAL_AWS_AND_PRODUCTION=NO_GO');
}
