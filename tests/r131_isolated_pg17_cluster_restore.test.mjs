import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {verifyIsolatedRecovery,FORMAT,REPO}
 from '../ops/r131_isolated_pg17_cluster_restore.mjs';

const FIX=Object.freeze({
 sourceSystemId:'7512345678901234512',
 targetSystemId:'7512345678901234513',
 sourceVersion:170011,targetVersion:170011,
 sourceCounts:'6:6:6:9:11:2',targetCounts:'6:6:6:9:11:2',
 dumpSha256:'f'.repeat(64),
 objectCount:2,storageAndRowsMatch:true,
 sqlRlsChecksPassed:true,priorEvidenceTrusted:true,
});
const fixture=()=>structuredClone(FIX);
const fails=(name,mutate,pattern)=>test(name,()=>{
 const x=fixture();mutate(x);
 assert.throws(()=>verifyIsolatedRecovery(x),pattern);
});

test('R131 validates two genuinely different physical PG17 clusters and never yields production GO',()=>{
 const result=verifyIsolatedRecovery(fixture());
 assert.equal(result.format,FORMAT);
 assert.equal(result.status,'PASS');
 assert.equal(result.distinctPhysicalPostgresClusterIds,'PASS');
 assert.equal(result.pg17SourceCustomDumpToFreshIndependentCluster,'PASS');
 assert.equal(result.restoredOwnerAndAnonRls,'PASS');
 assert.equal(result.objectCount,2);
 assert.equal(result.targetNetworkMode,'none');
 assert.equal(result.customerAuthOrSupabaseStorageVerified,false);
 assert.equal(result.productionChanged,false);
 assert.equal(result.productionCutoverAuthorized,false);
 assert.equal(result.verdict,'NO_GO');
 assert.doesNotMatch(JSON.stringify(result),/7512345678901234512/);
});
fails('same physical PostgreSQL cluster identifier refused',
 x=>{x.targetSystemId=x.sourceSystemId},/distinct/);
fails('no source PostgreSQL system identifier refused',
 x=>{delete x.sourceSystemId},/distinct/);
fails('wrong target PostgreSQL system identifier refused',
 x=>{x.targetSystemId='abc'},/distinct/);
fails('Postgres 16 source refused',
 x=>{x.sourceVersion=160022},/version 17/);
fails('Postgres 18 target refused',
 x=>{x.targetVersion=180000},/version 17/);
fails('fake semver string refused',
 x=>{x.sourceVersion='170011'},/version 17/);
fails('missing table counts refused',
 x=>{delete x.sourceCounts},/table counts/);
fails('mismatched restored table counts refused',
 x=>{x.targetCounts='6:6:6:9:11:1'},/table counts/);
fails('forged table count format refused',
 x=>{x.sourceCounts='select * from users'},/table counts/);
fails('wrong dump SHA-256 refused',
 x=>{x.dumpSha256='0'.repeat(40)},/dump digest/);
fails('missing dump digest refused',
 x=>{delete x.dumpSha256},/dump digest/);
fails('one synthetic Storage object missing refused',
 x=>{x.objectCount=1},/incomplete/);
fails('extra object in Storage refused',
 x=>{x.objectCount=3},/incomplete/);
fails('tampered restored PNG bytes refused',
 x=>{x.storageAndRowsMatch=false},/incomplete/);
fails('restored database privacy not proven refused',
 x=>{x.sqlRlsChecksPassed=false},/incomplete/);
fails('source R128/R130 proof missing refused',
 x=>{x.priorEvidenceTrusted=false},/incomplete/);
fails('unbounded numeric version refused',
 x=>{x.targetVersion=Number.MAX_SAFE_INTEGER+1},/version 17/);
test('R131 source only uses Docker no-network and forbids fake remote SQL/restores',()=>{
 const source=readFileSync(
   new URL('../ops/r131_isolated_pg17_cluster_restore.mjs',import.meta.url),
   'utf8');
 assert.match(source,/--network','none'/);
 assert.match(source,/--pull=never/);
 assert.match(source,/pg_control_system\(\)/);
 assert.match(source,/sourceSystemId!==targetSystemId/);
 assert.match(source,/CREATE ROLE anon NOLOGIN/);
 assert.match(source,/CREATE ROLE authenticated NOLOGIN/);
 assert.match(source,/--no-owner/);
 assert.doesNotMatch(source,/--no-acl','/);
 assert.match(source,/131_r130_restored_storage_acl\.sql/);
 assert.match(source,/verifyRowsAgainstStorage/);
 assert.match(source,/productionCutoverAuthorized:false/);
 assert.doesNotMatch(source,/https:\/\/.*supabase/);
});
test('R131 CLI refuses to contact Docker outside official GitHub local source container',()=>{
 const p=spawnSync(process.execPath,
  ['ops/r131_isolated_pg17_cluster_restore.mjs'],{
   cwd:new URL('../',import.meta.url),timeout:10000,encoding:'utf8',
   env:{...process.env,GITHUB_REPOSITORY:'untrusted/fork',
     PGHOST:'remote.fake',PGDATABASE:'production',
     SERVICE_CONTAINER:'not-a-real-docker-id'},
  });
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/R131_CROSS_CLUSTER_RECOVERY_REFUSED/);
 assert.doesNotMatch(p.stdout,/PASS/);
});
