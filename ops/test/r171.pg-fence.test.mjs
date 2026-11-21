import test from 'node:test';
import assert from 'node:assert/strict';
import {r171BuildFenceSql,createR171PostgresFence} from '../r171/pg-fence.mjs';
const vals={nonce:'a'.repeat(32),commit:'b'.repeat(40),
 archiveSha256:'c'.repeat(64),reviewerDigest:'d'.repeat(64),
 roleArn:'arn:aws:iam::111122223333:role/marcosa-staging-backup-role'};
test('R171 PostgreSQL atomic fence SQL has one transaction, restricted role, two interlocked inserts',()=>{
 const sql=r171BuildFenceSql(vals);
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/SET LOCAL ROLE marcosa_r171_writer/);
 assert.match(sql,/ON CONFLICT\(nonce\) DO NOTHING RETURNING nonce/);
 assert.match(sql,/INSERT INTO r171_ci.fenced_audit/);
 assert.match(sql,/COMMIT;/);
 assert.equal((sql.match(/INSERT INTO/g)||[]).length,2);
});
test('R171 PostgreSQL cross-process nonce contract accepts first, rejects duplicate and partial audit',async()=>{
 let count=0;
 const db=createR171PostgresFence({executeSql:async sql=>{
  assert.ok(sql.includes(vals.archiveSha256));
  return count++===0?'BEGIN\nSET\n1|1\nCOMMIT\n':'BEGIN\nSET\n0|0\nCOMMIT\n';
 },clock:()=>1800000000000});
 const grant=await db.consume(vals);
 assert.equal(grant.durablePostgresFence,true);
 assert.equal(grant.productionAuthorized,false);
 await assert.rejects(db.consume(vals),/nonce collision/);
 const partial=createR171PostgresFence({executeSql:async()=> 'BEGIN\nSET\n1|0\nCOMMIT\n'});
 await assert.rejects(partial.consume(vals),/ambiguous SQL/);
});
test('R171 PostgreSQL nonce input rejects injections, non staging roles and failed SQL',async()=>{
 for(const patch of [{nonce:"a');DROP TABLE x;--"},
  {commit:'0'},{roleArn:'arn:aws:iam::111122223333:role/production'},
  {reviewerDigest:'f'.repeat(65)}])
  assert.throws(()=>r171BuildFenceSql({...vals,...patch}),/R171 PostgreSQL fence/);
 const bad=createR171PostgresFence({executeSql:async()=>{
  throw Error('postgres connection lost');
 }});
 await assert.rejects(bad.consume(vals),/transaction rejected/);
});
