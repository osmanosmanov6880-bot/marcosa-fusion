import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgDispatcherStore,createConsentFencedWorker} from '../r159/outbox-worker.mjs';
const u='15900000-0000-4159-8159-000000000001',e='15900000-0000-4159-8159-000000000002',
token='15900000-0000-4159-8159-000000000003';
test('R159 SQL enforces dispatcher role per transaction and releases every connection',async()=>{
 const lines=[],releases=[];
 const pool={async connect(){return{
  async query(sql,values=[]){
   lines.push([sql,values]);
   if(sql.includes('r156_claim'))return{rows:[{id:'1',episode_id:e,user_id:u,lease_token:token}]};
   if(sql.includes('r157_delivery_fence')||sql.includes('r156_ack'))return{rows:[{allowed:true}]};
   return{rows:[]};
  },release(){releases.push(1);}
 };}};
 const dispatcher=createPgDispatcherStore({pool});
 assert.equal((await dispatcher.claim({workerId:'sample_worker',limit:1})).length,1);
 assert.equal(await dispatcher.allowed({id:'1',token}),true);
 assert.equal(await dispatcher.ack({id:'1',token}),true);
 assert.equal(releases.length,3);
 assert.equal(lines.filter(x=>x[0]==='SET LOCAL ROLE marcosa_r156_dispatcher').length,3);
 assert.equal(lines.filter(x=>x[0]==='COMMIT').length,3);
 assert.deepEqual(lines.find(x=>x[0].includes('r157_delivery_fence'))[1],['1',token]);
});
test('R159 allowed delivery, stable provider dedupe, immediate consent fence and PII-free logging',async()=>{
 const tasks=[{id:'1',episode_id:e,user_id:u,lease_token:token},
  {id:'2',episode_id:'15900000-0000-4159-8159-000000000004',user_id:u,lease_token:token}];
 const calls=[],acks=[],cancels=[],events=[];
 let pass=true;
 const dispatcher={
  claim:async()=>tasks,allowed:async({id})=>id==='1'&&pass,
  ack:async x=>{acks.push(x);return true;},
  nack:async()=>true,cancel:async x=>{cancels.push(x);return true;}
 };
 const provider={supportsIdempotency:true,supportsRecipientRecheck:true,
  send:async x=>{calls.push(x);return{accepted:true};}};
 const worker=createConsentFencedWorker({dispatcher,provider,logger:x=>events.push(x)});
 const outcome=await worker.runOnce();
 assert.deepEqual(outcome,{claimed:2,sent:1,revoked:1,retried:0,uncertain:0});
 assert.equal(calls.length,1);
 assert.equal(acks.length,1);
 assert.equal(cancels.length,1);
 assert.doesNotMatch(JSON.stringify(events),new RegExp(u));
 const firstKey=calls[0].idempotencyKey;
 await worker.runOnce();
 assert.equal(calls[1].idempotencyKey,firstKey);
 pass=false;
 await worker.runOnce();
 assert.equal(calls.length,2);
});
test('R159 provider failure retries but does not report success; transport requirements fail closed',async()=>{
 const work={id:'9',episode_id:e,user_id:u,lease_token:token},nacks=[];
 const dispatcher={
  claim:async()=>[work],allowed:async()=>true,ack:async()=>true,
  cancel:async()=>true,nack:async x=>{nacks.push(x);return true;}
 };
 const provider={supportsIdempotency:true,supportsRecipientRecheck:true,send:async()=>{throw Error('offline');}};
 const worker=createConsentFencedWorker({dispatcher,provider});
 const report=await worker.runOnce();
 assert.equal(report.retried,1);assert.equal(report.sent,0);
 assert.equal(nacks.length,1);
 assert.throws(()=>createConsentFencedWorker({dispatcher,provider:{...provider,supportsRecipientRecheck:false}}),
  /recheck consent/);
 assert.throws(()=>createPgDispatcherStore({pool:{}}),/restricted dispatcher/);
});
