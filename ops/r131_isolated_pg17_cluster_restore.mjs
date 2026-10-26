#!/usr/bin/env node
/**
 * R131: real pg_dump/pg_restore between TWO disposable PostgreSQL 17 clusters.
 * Target is Docker --network none, with new independent pg_control_system ID.
 * Fixture PNGs + RLS are checked without touching production or Supabase.
 */
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {lstatSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRestoredStorage,verifyRowsAgainstStorage}
  from './r130_disposable_storage_restore.mjs';

export const REPO='osmanosmanov6880-bot/marcosa-fusion';
export const FORMAT='MARCOSA-R131-INDEPENDENT-PG17-CLUSTER-RESTORE-v1';
const must=(condition,why)=>{if(!condition)throw Error(why)};
const SHA40=/^[a-f0-9]{40}$/,CID=/^[a-f0-9]{12,64}$/;
const SYSID=/^[0-9]{10,25}$/;
const IMAGE='postgres:17-alpine';
const sha256=data=>createHash('sha256').update(data).digest('hex');
const COUNT_SQL=[
 'SELECT concat((SELECT count(*) FROM auth.users),',
 "':',(SELECT count(*) FROM public.marcosa_profiles),",
 "':',(SELECT count(*) FROM public.marcosa_worlds),",
 "':',(SELECT count(*) FROM public.marcosa_posts),",
 "':',(SELECT count(*) FROM public.marcosa_comments),",
 "':',(SELECT count(*) FROM marcosa_private.world_cover_assets))",
].join('');
const MEDIA_SQL=[
 'SELECT a.world_id::text,a.uploaded_by::text,a.storage_key,',
 'a.sha256,a.byte_size::text,a.width::text,a.height::text,',
 "CASE WHEN a.normalized THEN 't' ELSE 'f' END,a.status,",
 "coalesce(a.reviewed_by::text,''),w.visibility ",
 'FROM marcosa_private.world_cover_assets a ',
 'JOIN public.marcosa_worlds w ON w.id=a.world_id ',
 "WHERE a.world_id IN ('12800000-0000-4128-8128-000000000101',",
 "'12800000-0000-4128-8128-000000000102') ORDER BY a.storage_key",
].join('');

export function verifyIsolatedRecovery({
 sourceSystemId,targetSystemId,sourceVersion,targetVersion,
 sourceCounts,targetCounts,dumpSha256,objectCount,storageAndRowsMatch,
 sqlRlsChecksPassed,priorEvidenceTrusted
}={}){
 must(typeof sourceSystemId==='string'&&SYSID.test(sourceSystemId)&&
      typeof targetSystemId==='string'&&SYSID.test(targetSystemId)&&
      sourceSystemId!==targetSystemId,
      'Two distinct real PostgreSQL cluster system IDs required');
 must(Number.isSafeInteger(sourceVersion)&&Number.isSafeInteger(targetVersion)&&
      sourceVersion>=170000&&sourceVersion<180000&&
      targetVersion>=170000&&targetVersion<180000,
      'Both isolated PostgreSQL instances must be version 17');
 must(typeof sourceCounts==='string'&&/^\d+(?::\d+){5}$/.test(sourceCounts)&&
      sourceCounts===targetCounts,'Cross-cluster restored table counts differ');
 must(typeof dumpSha256==='string'&&/^[a-f0-9]{64}$/.test(dumpSha256),
      'Actual source custom-format dump digest missing');
 must(objectCount===2&&storageAndRowsMatch===true&&
      sqlRlsChecksPassed===true&&priorEvidenceTrusted===true,
      'Restored RLS, Storage objects or prior synthetic proofs are incomplete');
 return Object.freeze({
   format:FORMAT,source:'disposable-synthetic-ci-only',
   status:'PASS',scope:'fresh_no_network_pg17_cluster_restore',
   distinctPhysicalPostgresClusterIds:'PASS',
   pg17SourceCustomDumpToFreshIndependentCluster:'PASS',
   restoredOwnerAndAnonRls:'PASS',
   restoredSyntheticMediaBytesAndRows:'PASS',
   objectCount:2,dumpSha256,targetNetworkMode:'none',
   customerAuthOrSupabaseStorageVerified:false,
   productionDatabaseOrFilesInspected:false,
   productionChanged:false,productionCutoverAuthorized:false,
   verdict:'NO_GO',
 });
}

const run=(cmd,args,{input=null,timeout=60000,maxBuffer=24*1024*1024}={})=>{
 const p=spawnSync(cmd,args,{input,timeout,maxBuffer,encoding:null});
 if(p.error||p.status!==0)
   throw Error(cmd+' operation refused (exit '+String(p.status)+')');
 return p.stdout;
};
const docker=(args,options)=>run('docker',args,options);
const sql=(cid,text,db='postgres')=>
 docker(['exec','-u','postgres',cid,'psql','-v','ON_ERROR_STOP=1',
         '-At','-d',db,'-c',text]).toString('utf8').trim();
const executeSqlFile=(cid,db,path)=>{
 const contents=readFileSync(path);
 must(contents.length>100&&contents.length<20000,
   'Only bounded reviewed PostgreSQL test scripts accepted');
 docker(['exec','-i','-u','postgres',cid,'psql',
   '-v','ON_ERROR_STOP=1','-d',db],{input:contents,timeout:30000});
};
function readSafeJson(path){
 const s=readFileSync(path);
 must(s.length>20&&s.length<8192,'Missing sanitized R128/R130 evidence');
 return JSON.parse(s.toString('utf8'));
}
function preflight(){
 must(process.env.GITHUB_REPOSITORY===REPO&&
   SHA40.test(process.env.GITHUB_SHA||'')&&
   process.env.PGHOST==='127.0.0.1'&&
   process.env.PGPORT==='5432'&&
   process.env.PGUSER==='postgres'&&process.env.PGDATABASE==='postgres'&&
   CID.test(process.env.SERVICE_CONTAINER||''),
   'R131 confined to official local-only PostgreSQL CI service');
 const dir=process.env.RUNNER_TEMP;
 must(typeof dir==='string'&&isAbsolute(dir)&&dir.length<280,
   'Private absolute runner directory required');
 const stat=lstatSync(dir);
 must(stat.isDirectory()&&!stat.isSymbolicLink(),
   'Symlink runner temporary directory forbidden');
 const a=readSafeJson('marcosa-r128-disposable-restore-proof.json');
 const b=readSafeJson('marcosa-r130-disposable-storage-restore-proof.json');
 must(a.source==='synthetic-local-ci-only'&&
   a.pgDumpAndNewDbRestore==='PASS'&&
   a.realCustomerDataIncluded===false&&a.verdict==='NO_GO'&&
   a.productionCutoverAuthorized===false&&
   b.source==='synthetic-local-ci-only'&&
   b.byteForByteSourceSnapshotAndNewStorageRestore==='PASS'&&
   b.realCustomerDataOrObjectsIncluded===false&&
   b.productionCutoverAuthorized===false&&b.verdict==='NO_GO',
   'Earlier two synthetic NO_GO acceptance artifacts are mandatory');
 const storage=verifyRestoredStorage(
   join(dir,'marcosa-r130-storage-snapshot'),
   join(dir,'marcosa-r130-restored'));
 must(storage.entries.length===2,'R131 expects two actually restored PNG objects');
 return {dir,storage};
}
async function execute(){
 must(process.argv.length===2,'R131 accepts no arbitrary file/host arguments');
 const {dir,storage}=preflight();
 // Use the exact already pulled service image; no new external image pulls.
 docker(['image','inspect',IMAGE],{maxBuffer:500000});
 const source=process.env.SERVICE_CONTAINER;
 const sourceSystemId=sql(source,'SELECT system_identifier::text FROM pg_control_system()');
 const sourceVersion=Number(sql(source,'SHOW server_version_num'));
 const sourceCounts=sql(source,COUNT_SQL);
 const dump=docker(['exec','-u','postgres',source,
   'pg_dump','-U','postgres','-d','postgres','--format=custom'],{timeout:60000});
 must(dump.length>=128&&dump.length<24*1024*1024,
   'Custom pg_dump outside bounded synthetic CI size');
 const dumpSha256=sha256(dump);
 const temporary=mkdtempSync(join(dir,'marcosa-r131-'));
 const backup=join(temporary,'synthetic.dump');
 writeFileSync(backup,dump,{flag:'wx',mode:0o600});
 let target='';
 try{
   const id=docker(['run','--detach','--rm','--pull=never',
     '--name','marcosa-r131-'+randomBytes(8).toString('hex'),
     '--network','none',
     '--env','POSTGRES_PASSWORD=synthetic-r131-only',
     '--env','POSTGRES_USER=postgres',
     '--env','POSTGRES_DB=postgres',IMAGE]).toString('utf8').trim();
   must(CID.test(id),'Fresh target cluster ID malformed');
   target=id;
   const net=docker(['inspect','--format','{{.HostConfig.NetworkMode}}',target],
     {maxBuffer:2000}).toString('utf8').trim();
   must(net==='none','Isolated target unexpectedly has network access');
   let started=false;
   for(let i=0;i<40;i++){
     const p=spawnSync('docker',['exec','-u','postgres',target,
       'pg_isready','-U','postgres','-d','postgres'],{
       timeout:3000,encoding:'utf8'});
     if(p.status===0){started=true;break}
     await new Promise(done=>setTimeout(done,500));
   }
   must(started,'Fresh PostgreSQL 17 container never started');
   const targetSystemId=sql(target,'SELECT system_identifier::text FROM pg_control_system()');
   const targetVersion=Number(sql(target,'SHOW server_version_num'));
   must(sourceSystemId!==targetSystemId,
     'Destination reused source physical PostgreSQL cluster');
   // pg_dump -Fc excludes global roles. Provision only approved fixture roles.
   sql(target,'CREATE ROLE anon NOLOGIN');
   sql(target,'CREATE ROLE authenticated NOLOGIN');
   sql(target,'CREATE DATABASE marcosa_r128_restored TEMPLATE template0');
   // --no-acl would hide accidental loss of original grants and is forbidden.
   docker(['exec','-i','-u','postgres',target,'pg_restore','-U','postgres',
     '--exit-on-error','--no-owner','-d','marcosa_r128_restored'],{
       input:readFileSync(backup),timeout:60000,
     });
   const targetCounts=sql(target,COUNT_SQL,'marcosa_r128_restored');
   executeSqlFile(target,'marcosa_r128_restored',
     'tests/postgres/130_pg17_restore_rls_isolation.sql');
   executeSqlFile(target,'marcosa_r128_restored',
     'tests/postgres/131_r130_restored_storage_acl.sql');
   const data=docker(['exec','-u','postgres',target,'psql',
     '-v','ON_ERROR_STOP=1','-At','-F','\t',
     '-d','marcosa_r128_restored','-c',MEDIA_SQL],
     {timeout:20000,maxBuffer:8192}).toString('utf8').trim();
   const rows=data.split(/\r?\n/).map(x=>x.split('\t'));
   const proof=verifyIsolatedRecovery({
     sourceSystemId,targetSystemId,sourceVersion,targetVersion,
     sourceCounts,targetCounts,dumpSha256,
     objectCount:storage.entries.length,
     storageAndRowsMatch:verifyRowsAgainstStorage(storage.entries,rows),
     sqlRlsChecksPassed:true,priorEvidenceTrusted:true,
   });
   writeFileSync('marcosa-r131-cross-cluster-disaster-recovery-proof.json',
     JSON.stringify({...proof,sourceSha:process.env.GITHUB_SHA},null,2)+'\n',
     {flag:'wx',mode:0o600});
   console.log('R131_FRESH_POSTGRES17_CLUSTER_NETWORK_NONE=PASS');
   console.log('R131_DIFFERENT_PHYSICAL_PG_CONTROL_IDENTIFIER=PASS');
   console.log('R131_REAL_PG_DUMP_RESTORE_RLS_AND_PNG=PASS');
   console.log('R131_REAL_SUPABASE_CUSTOMER_DATA=NOT_VERIFIED');
   console.log('R131_PRODUCTION_CUTOVER=NO_GO');
 }finally{
   if(target)spawnSync('docker',['rm','-f',target],{
     timeout:15000,stdio:'ignore'});
   rmSync(temporary,{recursive:true,force:true});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await execute()}
 catch(e){console.error('R131_CROSS_CLUSTER_RECOVERY_REFUSED='+
   String(e.message||e).slice(0,140));process.exitCode=2}
}
