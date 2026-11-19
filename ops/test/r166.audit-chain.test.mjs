import test from 'node:test';
import assert from 'node:assert/strict';
import {r166HashEntry,verifyR166Snapshot,createR166AuditChain,
 R166_HEAD_LOCK_SQL,R166_HEAD_READ_SQL,R166_EVENTS_READ_SQL,
 R166_HEAD_UPDATE_SQL,R166_EVENT_INSERT_SQL} from '../r166/audit-chain.mjs';
const commit='a'.repeat(40);
function fixture(){
 let head='0'.repeat(64),seq=0,records=[],rollbacks=0,commits=0;
 return{pool:{connect:async()=>({async query(sql,params=[]){
  if(sql===R166_HEAD_LOCK_SQL||sql===R166_HEAD_READ_SQL)
   return{rows:[{seq,head_sha256:head}]};
  if(sql===R166_EVENTS_READ_SQL)
   return{rows:records.map(x=>({seq:x.seq,observed_at_ms:x.atMs,
    category:x.category,outcome:x.outcome,source_commit:x.commit,
    prev_sha256:x.prev,entry_sha256:x.hash}))};
  if(sql===R166_EVENT_INSERT_SQL){
   records.push({seq:params[0],atMs:params[1],category:params[2],
    outcome:params[3],commit:params[4],prev:params[5],hash:params[6]});
   return{rows:[]};
  }
  if(sql===R166_HEAD_UPDATE_SQL){seq=params[0];head=params[1];return{rows:[{seq}]};}
  if(sql==='ROLLBACK')rollbacks++;
  if(sql==='COMMIT')commits++;
  return{rows:[]};
 },release(){}})},mutate:()=>{records[0].category='integrity_denied';},
  metrics:()=>({seq,head,rollbacks,commits})};
}
test('R166 PostgreSQL append, readback and independently anchored verification',async()=>{
 const f=fixture(),w=createR166AuditChain({pool:f.pool,commit});
 const first=await w.append({category:'nonce_consumed',outcome:'ok'});
 await w.append({category:'quarantine_closed',outcome:'blocked'});
 const s=await w.snapshot();
 assert.equal(s.seq,2);assert.equal(f.metrics().commits,2);
 assert.equal(verifyR166Snapshot(s,{expectedHead:s.head,commit}).matched,true);
 assert.equal(first.productionAuthorized,false);
 assert.throws(()=>verifyR166Snapshot({...s,head:'0'.repeat(64)}),/head mismatch/);
 f.mutate();await assert.rejects(w.snapshot(),/history inconsistent/);
});
test('R166 rejects arbitrary identities, empty commit and forged chain before DB access',async()=>{
 const f=fixture(),w=createR166AuditChain({pool:f.pool,commit});
 await assert.rejects(w.append({category:'email:user@example.com',outcome:'ok'}),/fixed nonpersonal/);
 await assert.rejects(w.append({category:'nonce_consumed',outcome:'deploy'}),/fixed nonpersonal/);
 assert.equal(f.metrics().commits,0);
 assert.throws(()=>createR166AuditChain({pool:f.pool,commit:'oops'}),/full SHA/);
 const entry={seq:1,atMs:1800000000000,category:'nonce_consumed',
  outcome:'ok',commit,prev:'0'.repeat(64)};
 const hash=r166HashEntry(entry);
 assert.equal(hash.length,64);
 assert.throws(()=>verifyR166Snapshot({seq:1,head:hash,productionAuthorized:false,
  entries:[{...entry,hash:'a'.repeat(64)}]},{expectedHead:hash}),/hash mismatch/);
});
