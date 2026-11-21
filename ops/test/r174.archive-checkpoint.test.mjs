import test from 'node:test';
import assert from 'node:assert/strict';
import {r174CheckpointSql,createR174ArchiveCheckpoint}
 from '../r174/archive-checkpoint.mjs';
const vals={expectedSequence:0,sequence:1,
 commit:'a'.repeat(40),archiveSha256:'b'.repeat(64),
 escrowSha256:'c'.repeat(64),evidenceSha256:'d'.repeat(64),
 archivedAtMs:1800000000000};
test('R174 monotonic checkpoint prevents sequence skips and includes append-only audit atomically',()=>{
 const q=r174CheckpointSql(vals);
 assert.match(q,/BEGIN;/);
 assert.match(q,/SET LOCAL ROLE marcosa_r174_writer/);
 assert.match(q,/ON CONFLICT DO NOTHING RETURNING sequence/);
 assert.match(q,/INSERT INTO r174_ci.checkpoint_events/);
 assert.match(r174CheckpointSql({...vals,sequence:2,expectedSequence:1}),
  /WHERE id=1 AND sequence=1 AND archived_at_ms<=1800000000000/);
 for(const q of [{sequence:3},{sequence:0},{archiveSha256:'bad'},
  {archivedAtMs:-1},{commit:"' OR 1=1"}])
 assert.throws(()=>r174CheckpointSql({...vals,...q}),/R174 archive checkpoint/);
});
test('R174 optimistic CAS accepts one commit, denies concurrent stale update and missing event',async()=>{
 let calls=0;
 const ledger=createR174ArchiveCheckpoint({
  executeSql:async()=>calls++===0?'BEGIN\nSET\n1|1\nCOMMIT':'BEGIN\nSET\n0|0\nCOMMIT',
  clock:()=>1800000000000
 });
 const a=await ledger.advance(vals);
 assert.equal(a.monotonicCheckpointAccepted,true);
 assert.equal(a.productionAuthorized,false);
 await assert.rejects(ledger.advance(vals),/checkpoint CAS lost/);
 await assert.rejects(createR174ArchiveCheckpoint({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).advance(vals),/audit missing/);
});
test('R174 fails closed when PostgreSQL adapter fails',async()=>{
 const ledger=createR174ArchiveCheckpoint({
  executeSql:async()=>{throw Error('DB offline');}
 });
 await assert.rejects(ledger.advance(vals),/atomic transaction rejected/);
});
