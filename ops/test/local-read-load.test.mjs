import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../local-read-load.mjs',import.meta.url));
test('R49: real 120-request Node/SQLite load proof is factual, not advertising traffic',()=>{
 const r=spawnSync(process.execPath,[entry],{
  cwd:resolve(new URL('../../',import.meta.url).pathname),
  encoding:'utf8',
  timeout:40000,
  env:{...process.env,MARCOSA_LOAD_READS:'120',MARCOSA_LOAD_CONCURRENCY:'4',MARCOSA_LOAD_P95_BUDGET_MS:'5000'}
 });
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-8000));
 const proof=JSON.parse(readFileSync(resolve('qa-r49/local-read-load.json'),'utf8'));
 assert.equal(proof.kind,'disposable-local-loopback-read-smoke');
 assert.equal(proof.source,'real HTTP and SQLite');
 assert.equal(proof.completed,120);
 assert.equal(proof.failed,0);
 assert.equal(proof.production,false);
 assert.equal(proof.externalUsers,0);
 assert.equal(proof.measuredProductionLatency,false);
 assert.ok(proof.p95Ms>0&&proof.p95Ms<=5000);
 assert.ok(proof.peakConcurrency>=2&&proof.peakConcurrency<=4);
 assert.equal(proof.httpStatuses['200'],120);
 assert.equal(Object.keys(proof.routeRequests).length,9);
 assert.doesNotMatch(JSON.stringify(proof),/password_hash|token_hash|refresh_token|service_role/);
});
test('R49: unrealistic or unsafe load settings rejected rather than exhausting CI',()=>{
 for(const settings of [
  {MARCOSA_LOAD_READS:'0'},
  {MARCOSA_LOAD_READS:'100000'},
  {MARCOSA_LOAD_CONCURRENCY:'1024'},
  {MARCOSA_LOAD_P95_BUDGET_MS:'-5'},
 ]){
  const result=spawnSync(process.execPath,[entry],{
   encoding:'utf8',timeout:10000,env:{...process.env,...settings}
  });
  assert.equal(result.status,2,'Unsafe settings must be rejected: '+JSON.stringify(settings));
  assert.match(result.stderr,/refusing invalid load settings/);
 }
});
