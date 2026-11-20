/** CI-only native PG17: one-use audit, denial, pg_dump, isolated restore. */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createR192NativeLedger} from './native-ledger.mjs';
import {R192_NO_GO} from './release-verdict.mjs';
const e=process.env;
const fail=m=>{throw Error('R192 PostgreSQL17 acceptance: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 /^[a-f0-9]{12,64}$/.test(e.R192_PG_CONTAINER||'')&&
 e.PGHOST==='127.0.0.1'&&e.PGDATABASE==='postgres'&&
 [e.R192_RELEASE_SHA,e.R192_REVIEW_SHA,e.R192_IAM_SHA,e.R192_ROTATION_SHA]
  .every(v=>/^[a-f0-9]{64}$/.test(v||''))&&
 !e.AWS_ACCESS_KEY_ID&&!e.AWS_SECRET_ACCESS_KEY&&
 !e.AWS_SESSION_TOKEN&&!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'CI-only disposable source and pinned evidence SHA values required');
function call(app,args,{input}={}){
 const res=spawnSync(app,args,{input,encoding:null,
  maxBuffer:48*1024*1024,timeout:120000});
 ok(!res.error&&res.status===0,'native postgres command failed');
 return res.stdout;
}
const sql=(db,q)=>call('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1',
 '-d',db,'-c',q]).toString('utf8').trim();
ok(sql('postgres',"SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999")==='t',
 'real PostgreSQL 17 required');
const packet={
 sourceCommit:e.GITHUB_SHA,
 parentR191Commit:'534b65791b21b514b96894014def478352ba8a70',
 sourceBundleSha256:sha('R192-DISPOSABLE:'+e.GITHUB_SHA),
 reviewEvidenceSha256:e.R192_REVIEW_SHA,
 iamRiskEvidenceSha256:e.R192_IAM_SHA,
 rotationEvidenceSha256:e.R192_ROTATION_SHA,
 releaseEvidenceSha256:e.R192_RELEASE_SHA,
 decision:R192_NO_GO,sourceMode:'CI_DISPOSABLE',productionAuthorized:false
};
const ledger=createR192NativeLedger({executeSql:async q=>sql('postgres',q)});
ok((await ledger.append(packet)).recorded===true,'one-use R192 insert failed');
const count=db=>sql(db,"SELECT (SELECT count(*) FROM r192_ci.release_holds)::text||'|'||"+
 "(SELECT count(*) FROM r192_ci.release_audit)::text||'|'||"+
 "(SELECT production_authorized::text FROM r192_ci.release_holds WHERE id=1)");
const rls=db=>sql(db,"SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
 "WHERE oid='r192_ci.release_holds'::regclass)::text||'|'||"+
 "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
 "WHERE oid='r192_ci.release_audit'::regclass)::text||'|'||"+
 "(NOT has_table_privilege('authenticated','r192_ci.release_holds','SELECT'))::text||'|'||"+
 "(NOT has_table_privilege('marcosa_r192_writer','r192_ci.release_holds','UPDATE'))::text");
ok(count('postgres')==='1|1|false'&&rls('postgres')==='true|true|true|true',
 'hold, audit, FORCE RLS or user privileges not enforced');
let deniedReplay=false;
try{await ledger.append(packet);}catch{deniedReplay=true;}
ok(deniedReplay,'native PostgreSQL permitted duplicate append');
function negative(query){
 const r=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-c',query],
  {encoding:'utf8',timeout:20000});
 ok(r.status!==0,'native PG17 accepted dangerous role operation');
}
negative("BEGIN; SET LOCAL ROLE marcosa_r192_writer; UPDATE r192_ci.release_holds SET decision='GO'; COMMIT;");
negative("BEGIN; SET LOCAL ROLE authenticated; SELECT * FROM r192_ci.release_holds; COMMIT;");
const row=db=>sql(db,"SELECT source_commit||'|'||parent_r191_commit||'|'||"+
 "source_bundle_sha256||'|'||review_sha256||'|'||iam_risk_sha256||'|'||"+
 "rotation_sha256||'|'||release_sha256||'|'||decision FROM "+
 "r192_ci.release_holds WHERE id=1");
const before=row('postgres');
const archive=call('docker',['exec','-u','postgres',e.R192_PG_CONTAINER,
 'pg_dump','-U','postgres','-d','postgres','-Fc']);
ok(archive.length>512&&archive.subarray(0,5).toString('utf8')==='PGDMP',
 'real custom PostgreSQL backup missing');
try{
 sql('postgres','CREATE DATABASE marcosa_r192_restored TEMPLATE template0');
 call('docker',['exec','-u','postgres','-i',e.R192_PG_CONTAINER,
  'pg_restore','-U','postgres','-d','marcosa_r192_restored',
  '--no-owner','--exit-on-error'],{input:archive});
}finally{archive.fill(0);}
ok(before===row('marcosa_r192_restored')&&
 count('marcosa_r192_restored')==='1|1|false'&&
 rls('marcosa_r192_restored')==='true|true|true|true',
 'restored PG17 NO-GO receipt, SHA chain or RLS changed');
deniedReplay=false;
try{
 await createR192NativeLedger({executeSql:async q=>sql('marcosa_r192_restored',q)})
  .append(packet);
}catch{deniedReplay=true;}
ok(deniedReplay,'recovered PG17 admitted duplicate write');
console.log('R192_REAL_DISPOSABLE_PG17_FORCE_RLS_BACKUP_RESTORE_REPLAY=PASS');
console.log('R192_LIVE_STAGING_RECOVERY_UNVERIFIED_PRODUCTION=NO_GO');
