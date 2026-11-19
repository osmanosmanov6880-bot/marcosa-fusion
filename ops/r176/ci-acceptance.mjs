/**
 * R176 CI: native PostgreSQL17 real append-only gates and dump/restore.
 * Synthetic S3 and AWS only. Separate runner checks source-bound report.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR175RecoveryNonce} from '../r175/recovery-nonce.mjs';
import {createR176RecoveryFence} from './recovery-fence.mjs';
const env=process.env,fail=m=>{throw Error('R176 CI acceptance: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H64=/^[a-f0-9]{64}$/;
const name='r176-isolated-offsite-chain-report.json';
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'only GitHub Actions without real credentials allowed');
const bundle=await buildR163Bundle({root:process.cwd(),commit:env.GITHUB_SHA});
if(env.R176_SECOND_RUNNER==='true'){
 ok(!env.PGHOST&&!env.PGPASSWORD,'independent runner cannot access PG');
 const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,'r176-second',name),'utf8'));
 const fields=['schemaVersion','commit','bundleSha256',
  'realPg17R175UniqueSequence','realPg17SecondAuditRls',
  'realPg17SecondNonceAndSequenceReplayDenied',
  'realPg17NativeRestoreRetainedBothGates',
  'r175NativePgAndSyntheticOffsiteHistoryPassed',
  'dualEd25519AncestorChainUnitPassed','offsiteS3ReadBackUnitPassed',
  'realAwsAccountsUsed','realHumansIdentified',
  'actualProductionRpoRtoProven','productionAuthorized'].sort().join(',');
 ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
  Object.keys(report).sort().join(',')===fields&&
  report.schemaVersion===1&&report.commit===env.GITHUB_SHA&&
  report.bundleSha256===bundle.sha256&&H64.test(report.bundleSha256),
  'independent source-bound evidence changed');
 for(const key of ['realPg17R175UniqueSequence','realPg17SecondAuditRls',
  'realPg17SecondNonceAndSequenceReplayDenied',
  'realPg17NativeRestoreRetainedBothGates',
  'r175NativePgAndSyntheticOffsiteHistoryPassed',
  'dualEd25519AncestorChainUnitPassed','offsiteS3ReadBackUnitPassed'])
  ok(report[key]===true,'missing isolated acceptance: '+key);
 for(const key of ['realAwsAccountsUsed','realHumansIdentified',
  'actualProductionRpoRtoProven','productionAuthorized'])
  ok(report[key]===false,'synthetic evidence cannot authorize production');
 console.log('R176_SECOND_RUNNER_INDEPENDENT_SOURCE_AND_REPORT=PASS');
 console.log('R176_PRODUCTION=NO_GO');
}else{
 ok(env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
  /^[a-f0-9]{12,64}$/.test(env.R176_PG_CONTAINER||''),
  'real disposable PG17 container is mandatory');
 const run=(cmd,args,{input}={})=>{
  const r=spawnSync(cmd,args,{input,encoding:null,timeout:60000,
   maxBuffer:40*1024*1024});
  ok(r.status===0&&!r.error,'native disposable PG17 operation failed');
  return r.stdout;
 };
 const sql=(database,statement)=>run('psql',['-X','-A','-t',
  '-v','ON_ERROR_STOP=1','-d',database,'-c',statement])
  .toString('utf8').trim();
 const previous=JSON.parse(await readFile(join(env.RUNNER_TEMP,
  'r175-isolated-source-anchor-report.json'),'utf8'));
 ok(previous.commit===env.GITHUB_SHA&&
  previous.bundleSha256===bundle.sha256&&
  previous.realPg17NativeBackupRestorePreservesR175Lease===true&&
  previous.supervisorAnchorBeforeLeaseChecked===true&&
  previous.syntheticOffsiteS3ImmutableAnchorSha256Verified===true&&
  previous.productionAuthorized===false,
  'previous real PG17 R175 + synthetic offsite acceptance required');
 const high=sql('postgres',
  "SELECT c.sequence::text||'|'||c.source_commit||'|'||c.archive_sha256||'|'||c.evidence_sha256||'|'||l.nonce||'|'||l.anchor_sha256 FROM r174_ci.checkpoint c JOIN r175_ci.recovery_leases l ON l.sequence=c.sequence WHERE c.id=1");
 const [seq,commit,archiveSha256,checkpointSha256,nonce,anchorSha256]=high.split('|');
 ok(Number(seq)===2&&commit===env.GITHUB_SHA&&
  H64.test(archiveSha256)&&H64.test(checkpointSha256)&&
  /^[a-f0-9]{32}$/.test(nonce)&&H64.test(anchorSha256),
  'exact R175 primary PostgreSQL nonce and current R174 checkpoint missing');
 const input={nonce,sequence:Number(seq),commit,archiveSha256,
  checkpointSha256,anchorSha256};
 const r176=createR176RecoveryFence({
  executeSql:async statement=>sql('postgres',statement)
 });
 ok((await r176.admit(input)).admittedExactlyOnce,
  'second true PostgreSQL SERIALIZABLE admission missing');
 let denied=false;
 try{await createR176RecoveryFence({
  executeSql:async statement=>sql('postgres',statement)
 }).admit(input);}catch{denied=true;}
 ok(denied,'second connection could replay R176 archive sequence');
 const fakeNonce='a'.repeat(32);
 denied=false;
 try{await createR175RecoveryNonce({
  executeSql:async statement=>sql('postgres',statement)
 }).consume({...input,nonce:fakeNonce});}catch{denied=true;}
 ok(denied,'new nonce succeeded for same R175 archive sequence');
 const counts=db=>sql(db,
  "SELECT (SELECT count(*) FROM r175_ci.recovery_leases)::text||'|'||(SELECT count(*) FROM r175_ci.recovery_audit)::text||'|'||(SELECT count(*) FROM r176_ci.admissions)::text||'|'||(SELECT count(*) FROM r176_ci.admission_audit)::text");
 ok(counts('postgres')==='1|1|1|1','exactly one immutable lease and audit per layer');
 const privileges=sql('postgres',
  "SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='r176_ci.admissions'::regclass)::text||'|'||(NOT has_table_privilege('marcosa_r176_writer','r174_ci.checkpoint','UPDATE'))::text||'|'||(NOT has_table_privilege('authenticated','r176_ci.admissions','SELECT'))::text");
 ok(privileges==='true|true|true','FORCE RLS or browser/write denial weakened');
 const dump=run('docker',['exec','-u','postgres',env.R176_PG_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','-Fc']);
 ok(dump.subarray(0,5).toString('utf8')==='PGDMP'&&dump.length>512,
  'native PostgreSQL17 custom backup missing');
 try{
  sql('postgres','CREATE DATABASE marcosa_r176_restored TEMPLATE template0');
  run('docker',['exec','-u','postgres','-i',env.R176_PG_CONTAINER,
   'pg_restore','-U','postgres','-d','marcosa_r176_restored',
   '--no-owner','--exit-on-error'],{input:dump});
 }finally{dump.fill(0);}
 ok(counts('marcosa_r176_restored')==='1|1|1|1',
  'restored PG17 lost independent append-only sequence fences');
 const restoredRls=sql('marcosa_r176_restored',
  "SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid='r176_ci.admissions'::regclass");
 ok(restoredRls==='true','PG17 restore lost FORCE RLS');
 let restoreReplayDenied=false;
 try{await createR176RecoveryFence({
  executeSql:async statement=>sql('marcosa_r176_restored',statement)
 }).admit(input);}catch{restoreReplayDenied=true;}
 ok(restoreReplayDenied,'restored database accepted replayed admission');
 const report={schemaVersion:1,commit:env.GITHUB_SHA,
  bundleSha256:bundle.sha256,
  realPg17R175UniqueSequence:true,
  realPg17SecondAuditRls:true,
  realPg17SecondNonceAndSequenceReplayDenied:true,
  realPg17NativeRestoreRetainedBothGates:true,
  r175NativePgAndSyntheticOffsiteHistoryPassed:true,
  dualEd25519AncestorChainUnitPassed:true,
  offsiteS3ReadBackUnitPassed:true,
  realAwsAccountsUsed:false,realHumansIdentified:false,
  actualProductionRpoRtoProven:false,productionAuthorized:false};
 await writeFile(join(env.RUNNER_TEMP,name),JSON.stringify(report,null,2)+'\n',
  {flag:'wx',mode:0o600});
 console.log('R176_PG17_DOUBLE_IMMUTABLE_FENCES_AND_NATIVE_RESTORE=PASS');
 console.log('R176_COMPLETE_SIGNED_OFFSITE_HISTORY_UNIT=PASS');
 console.log('R176_REAL_AWS_HUMAN_APPROVAL_AND_PRODUCTION=NO_GO');
}
