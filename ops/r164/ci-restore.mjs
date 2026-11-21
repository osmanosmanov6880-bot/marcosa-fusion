/**
 * R164 real disposable PostgreSQL 17 recovery (CI only).
 * No hosted Supabase, live accounts or non-loopback database connections.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR164RestoreWitness,verifyR164RestoreWitness} from './restore-witness.mjs';

const repo='osmanosmanov6880-bot/marcosa-fusion';
const check=(v,m)=>{if(!v)throw Error('R164 disposable restore: '+m);};
check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY===repo&&
 process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='postgres'&&
 process.env.R164_DB_PASSWORD==='r160-disposable-admin-only'&&
 /^[a-f0-9]{12,64}$/.test(process.env.R164_SERVICE_CONTAINER||'')&&
 /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||'')&&
 typeof process.env.RUNNER_TEMP==='string',
 'isolated, disposable GitHub PG17 fixture required');
const container=process.env.R164_SERVICE_CONTAINER;
const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'5432',
 PGUSER:'postgres',PGPASSWORD:process.env.R164_DB_PASSWORD};
function run(binary,args,{input,timeout=30000}={}){
 const v=spawnSync(binary,args,{input,env,timeout,maxBuffer:30*1024*1024});
 check(v.status===0&&!v.error,'isolated command failed: '+binary);
 return v.stdout;
}
function query(db,statement){
 return run('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-d',db,'-c',statement])
  .toString('utf8').trim();
}
const inv=[
 "SELECT json_build_object(",
 "'seasonRevision',(SELECT revision FROM public.marcosa_seasons WHERE id='15900000-0000-4159-8159-000000000301'::uuid),",
 "'commandCount',(SELECT count(*) FROM marcosa_private.r156_commands WHERE actor_id='15900000-0000-4159-8159-000000000001'::uuid),",
 "'inboxRows',(SELECT count(*) FROM marcosa_private.r161_webhook_inbox),",
 "'inboxAcknowledgements',(SELECT sum(accepted_count) FROM marcosa_private.r161_webhook_inbox),",
 "'revokedSessions',(SELECT count(*) FROM auth.sessions WHERE id='16100000-0000-4161-8161-000000000502'::uuid),",
 "'activeSessions',(SELECT count(*) FROM auth.sessions WHERE id='16100000-0000-4161-8161-000000000501'::uuid),",
 "'sessionRls',(SELECT relrowsecurity FROM pg_class WHERE oid='auth.sessions'::regclass),",
 "'inboxRls',(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.r161_webhook_inbox'::regclass),",
 "'browserCanReadSessions',has_table_privilege('authenticated','auth.sessions','SELECT'),",
 "'browserCanReadInbox',has_table_privilege('authenticated','marcosa_private.r161_webhook_inbox','SELECT'))::text;"
].join(' ');
const checkpointAtMs=Date.now();
const source=JSON.parse(query('postgres',inv));
const dump=run('docker',['exec','-u','postgres',container,'pg_dump','-U','postgres',
 '-d','postgres','--format=custom'],{timeout:40000});
check(Buffer.isBuffer(dump)&&dump.length>512&&dump.length<25*1024*1024,
 'unexpected archive size');
const archiveSha256=createHash('sha256').update(dump).digest('hex');
const file=join(process.env.RUNNER_TEMP,'r164-disposable-backup.dump');
await writeFile(file,dump,{flag:'wx',mode:0o600});
const onDisk=await readFile(file);
check(createHash('sha256').update(onDisk).digest('hex')===archiveSha256,
 'backup changed after write');
query('postgres','CREATE DATABASE marcosa_r164_restored TEMPLATE template0;');
run('docker',['exec','-u','postgres','-i',container,'pg_restore','-U','postgres',
 '-d','marcosa_r164_restored','--no-owner','--exit-on-error'],
 {input:onDisk,timeout:45000});
const restored=JSON.parse(query('marcosa_r164_restored',inv));
const bad=spawnSync('docker',['exec','-u','postgres','-i',container,
 'pg_restore','--list'],{input:Buffer.from('invalid-pg-archive'),
 env,timeout:8000,maxBuffer:1024*1024});
check(bad.status!==0,'corrupt archive wrongly accepted');
const commit=process.env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const witness=createR164RestoreWitness({
 commit,bundleSha256:bundle.sha256,archiveSha256,
 sourceDb:'postgres',restoreDb:'marcosa_r164_restored',
 source,restored,checkpointAtMs,restoredAtMs:Date.now(),
 corruptBackupRejected:true,scope:'synthetic-ci'});
check(verifyR164RestoreWitness(witness,{commit,
 bundleSha256:bundle.sha256,witnessDigest:witness.witnessDigest}).matched,
 'independent restore witness rejected');
await writeFile(join(process.env.RUNNER_TEMP,'r164-restored-witness.json'),
 JSON.stringify(witness,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('R164_REAL_PG17_CUSTOM_DUMP_AND_INDEPENDENT_DATABASE_RESTORE=PASS');
console.log('R164_REVOKED_SESSION_RLS_AND_INBOX_IDEMPOTENCY=PASS');
console.log('R164_CORRUPTED_BACKUP_REJECTED=PASS');
console.log('R164_OBSERVED_RTO_MS='+witness.rtoObservedMs);
console.log('R164_ONLY_SYNTHETIC_DISPOSABLE_PG17=PASS');
