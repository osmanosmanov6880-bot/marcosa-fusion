import test from 'node:test';
import assert from 'node:assert/strict';
import {readR167FixtureInventory,R167_INVENTORY_SQL} from '../r167/pg-witness.mjs';
const testJson=()=>({pgVersion:170012,publicRows:3,privateRows:2,
 auditRows:3,activeSessions:1,revokedSessions:1,quarantineClosed:true,
 quarantineGeneration:5,auditHead:'c'.repeat(64),publicRls:true,privateRls:true,
 browserCanReadPrivate:false,readerCanReadPrivate:true,
 writerCanDeleteAudit:false,
 rows:{episodes:[{id:'1'},{id:'2'},{id:'3'}],sessions:[{id:'a'},{id:'b'}],
  audit:[{seq:1},{seq:2},{seq:3}],quarantine:{closed:true,generation:5}}});
test('R167 PG17 inventory fingerprints rows without exposing synthetic identities',async()=>{
 const input=testJson();
 const inventory=await readR167FixtureInventory({sqlRead:async sql=>{
  assert.equal(sql,R167_INVENTORY_SQL);return JSON.stringify(input);}});
 assert.equal(inventory.publicRows,3);
 assert.equal(inventory.quarantineClosed,true);
 assert.match(inventory.rowsDigest,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(inventory).includes('"episodes"'),false);
});
test('R167 rejects stale PG version, broken role policy and missing row',async()=>{
 for(const change of [
  {pgVersion:160019},
  {quarantineClosed:false},
  {browserCanReadPrivate:true},
  {publicRows:2},
  {rows:{...testJson().rows,sessions:[]}}
 ]){
  await assert.rejects(readR167FixtureInventory({sqlRead:async()=>
   JSON.stringify({...testJson(),...change})}),/R167/);
 }
});
