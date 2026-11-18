import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDisposableR156Environment} from '../r156/concurrency.mjs';

const valid={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
 PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'postgres',PGUSER:'postgres',RUNNER_TEMP:'/tmp'};
test('R156 refuses workstation, production and remote PostgreSQL environments',()=>{
 for(const [name,value] of [
  ['GITHUB_ACTIONS','false'],['GITHUB_REPOSITORY','attacker/fork'],
  ['PGHOST','db.internal'],['PGHOST','localhost'],['PGPORT','5433'],
  ['PGDATABASE','customer'],['PGUSER','admin'],['RUNNER_TEMP','relative']]){
  assert.throws(()=>assertDisposableR156Environment({...valid,[name]:value}),/isolated/);
 }
 assert.equal(assertDisposableR156Environment(valid),true);
});
