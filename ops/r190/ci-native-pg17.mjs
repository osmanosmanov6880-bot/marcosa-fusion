/** Actual disposable PG17 append, replay denial, pg_dump and independent restore. */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createR190NativeLedger} from './native-ledger.mjs';
const e=process.env;
const fail=m=>{throw Error('R190 native PG17: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 e.PGHOST==='127.0.0.1'&&e.PGDATABASE==='postgres'&&
 /^[a-f0-9]{12,64}$/.test(e.R190_PG_CONTAINER||'')&&
 !e.AWS_ACCESS_KEY_ID&&!e.AWS_SECRET_ACCESS_KEY&&
 !e.AWS_SESSION_TOKEN&&!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'disposable isolated DB and nonprivileged CI only');
const command=(app,args,{input}={})=>{
 const r=spawnSync(app,args,{encoding:null,input,timeout:120000,maxBuffer:48*1024*1024});
 ok(!r.error&&r.status===0,'native database command refused');
 return r.stdout.toString('utf8');
};
const sql=(db,q)=>command('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1',
 '-d',db,'-c',q]).trim();
const version=sql('postgres',"SELECT current_setting('server_version_num')::integer BETWEEN 170000 AND 179999");
ok(version==='t','expected PostgreSQL 17');
const digest=s=>createHash('sha256').update(s).digest('hex');
const packet={
 sourceCommit:e.GITHUB_SHA,r189Commit:'34ecc58a3c9852514909e8ac44093f8cc74a8beb',
 bundleSha256:digest('R190-'+e.GITHUB_SHA),
 githubEvidenceSha256:digest('R190-github-'+e.GITHUB_SHA),
 signaturesEvidenceSha256:digest('R190-signature-'+e.GITHUB_SHA),
 tlsEvidenceSha256:digest('R190-tls-'+e.GITHUB_SHA),
 sourceMode:'CI_SYNTHETIC',decision:'NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING',
 productionAuthorized:false
};
const ledger=createR190NativeLedger({executeSql:async q=>sql('postgres',q)});
ok((await ledger.record(packet)).recorded===true,'real atomic append failed');
const count=db=>sql(db,"SELECT (SELECT count(*) FROM r190_ci.immutable_hold)::text||'|'||"+
 "(SELECT count(*) FROM r190_ci.immutable_audit)::text||'|'||"+
 "(SELECT production_authorized::text FROM r190_ci.immutable_hold WHERE id=1)");
const secure=db=>sql(db,"SELECT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
 "WHERE oid='r190_ci.immutable_hold'::regclass)::text||'|'||"+
 "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
 "WHERE oid='r190_ci.immutable_audit'::regclass)::text||'|'||"+
 "(NOT has_table_privilege('authenticated','r190_ci.immutable_hold','SELECT'))::text||'|'||"+
 "(NOT has_table_privilege('marcosa_r190_writer','r190_ci.immutable_hold','UPDATE'))::text");
ok(count('postgres')==='1|1|false'&&secure('postgres')==='true|true|true|true',
 'native source row, audit or FORCE RLS privileges wrong');
let replay=false;
try{await ledger.record(packet);}catch{replay=true;}
ok(replay,'real PG17 replay allowed');
function denied(q){
 const r=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-c',q],
  {encoding:'utf8',timeout:20000});
 ok(r.status!==0,'forbidden PostgreSQL command was allowed');
}
denied("BEGIN; SET LOCAL ROLE marcosa_r190_writer; UPDATE r190_ci.immutable_hold SET decision='GO'; COMMIT;");
denied("BEGIN; SET LOCAL ROLE authenticated; SELECT * FROM r190_ci.immutable_hold; COMMIT;");
const archive=spawnSync('docker',['exec','-u','postgres',e.R190_PG_CONTAINER,
 'pg_dump','-U','postgres','-d','postgres','-Fc'],
 {encoding:null,timeout:120000,maxBuffer:48*1024*1024});
ok(archive.status===0&&archive.stdout.length>512&&
 archive.stdout.subarray(0,5).toString('utf8')==='PGDMP','no authentic custom pg_dump archive');
const bytes=archive.stdout;
const original=sql('postgres',"SELECT source_commit||'|'||r189_commit||'|'||"+
 "bundle_sha256||'|'||github_sha256||'|'||signature_sha256||'|'||tls_sha256||'|'||"+
 "decision FROM r190_ci.immutable_hold WHERE id=1");
try{
 sql('postgres','CREATE DATABASE marcosa_r190_restored TEMPLATE template0');
 const restored=spawnSync('docker',['exec','-u','postgres','-i',e.R190_PG_CONTAINER,
  'pg_restore','-U','postgres','-d','marcosa_r190_restored',
  '--no-owner','--exit-on-error'],{input:bytes,encoding:null,timeout:120000,maxBuffer:48*1024*1024});
 ok(restored.status===0,'native pg_restore failed');
}finally{bytes.fill(0);}
const recovered=sql('marcosa_r190_restored',"SELECT source_commit||'|'||r189_commit||'|'||"+
 "bundle_sha256||'|'||github_sha256||'|'||signature_sha256||'|'||tls_sha256||'|'||"+
 "decision FROM r190_ci.immutable_hold WHERE id=1");
ok(original===recovered&&count('marcosa_r190_restored')==='1|1|false'&&
 secure('marcosa_r190_restored')==='true|true|true|true',
 'native recovered holds, hash fields, audit or RLS differ');
replay=false;
try{await createR190NativeLedger({executeSql:async q=>sql('marcosa_r190_restored',q)}).record(packet);}
catch{replay=true;}
ok(replay,'recovered PG17 replay allowed');
console.log('R190_REAL_DISPOSABLE_PG17_FORCE_RLS_ATOMIC_APPEND_REPLAY_RESTORE=PASS');
console.log('R190_EXTERNAL_HUMAN_STAGING_AWS_PRIVACY_PRODUCTION=NO_GO');
