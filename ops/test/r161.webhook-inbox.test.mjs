import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {createR161WebhookInbox,R161_WEBHOOK_INSERT_SQL,createR161WebhookInboxServer} from '../r161/webhook-inbox.mjs';
const episodeId='16100000-0000-4161-8161-000000000001';
const recipientId='16100000-0000-4161-8161-000000000002';
const secret='r161-isolated-signed-webhook-recipient-secret-64characters';
const fixed=1800000000000;
const idempotencyKey='marcosa-r159-'+createHash('sha256')
 .update(episodeId+':'+recipientId).digest('hex');
function request({timestamp=Math.floor(fixed/1000),nonce='a'.repeat(32),
 key=idempotencyKey,payload}={}){
 const body=Buffer.from(JSON.stringify(payload||{
  event:'new_episode',episodeId,recipientId,
  createdAtSeconds:timestamp,deliveryAttemptIdempotencyKey:key
 }));
 const signature=createHmac('sha256',secret)
  .update(timestamp+'\n'+nonce+'\n'+key+'\n').update(body).digest('hex');
 return{headers:{'content-type':'application/json','idempotency-key':key,
  'x-marcosa-timestamp':String(timestamp),'x-marcosa-nonce':nonce,
  'x-marcosa-signature':'v1='+signature},rawBody:body};
}
function db(){
 let count=0,queries=[],commits=0,rollbacks=0,released=0;
 const pool={connect:async()=>({
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql===R161_WEBHOOK_INSERT_SQL){count++;return{rows:[{accepted_count:count}]};}
   if(sql==='COMMIT')commits++;
   if(sql==='ROLLBACK')rollbacks++;
   return{rows:[]};
  },release(){released++;}
 })};
 return{pool,meta:()=>({queries,commits,rollbacks,released})};
}
test('R161 HMAC persists stable key; repeated delivery only increments same SQL row',async()=>{
 const fixture=db(),inbox=createR161WebhookInbox({pool:fixture.pool,
  signatureSecret:secret,clock:()=>fixed});
 const first=await inbox.accept(request());
 const again=await inbox.accept(request({nonce:'b'.repeat(32)}));
 assert.equal(first.accepted,true);assert.equal(first.duplicate,false);
 assert.equal(again.accepted,true);assert.equal(again.duplicate,true);
 const m=fixture.meta();
 assert.equal(m.commits,2);assert.equal(m.released,2);assert.equal(m.rollbacks,0);
 assert.deepEqual(m.queries.filter(x=>x.sql===R161_WEBHOOK_INSERT_SQL)
  .map(x=>x.params),[[idempotencyKey,episodeId,recipientId],
   [idempotencyKey,episodeId,recipientId]]);
});
test('R161 invalid MAC, expired delivery, altered body and conflicting dedupe refuse DB writes',async()=>{
 const fixture=db(),inbox=createR161WebhookInbox({pool:fixture.pool,
  signatureSecret:secret,clock:()=>fixed});
 const wrong=request();wrong.headers['x-marcosa-signature']='v1='+('0'.repeat(64));
 const expired=request({timestamp:Math.floor(fixed/1000)-3600});
 const changed=request();changed.rawBody=Buffer.from('{}');
 const reused=request({key:'marcosa-r159-'+('0'.repeat(64))});
 for(const item of [wrong,expired,changed,reused])
  await assert.rejects(inbox.accept(item),e=>e.status===401||e.status===400);
 assert.equal(fixture.meta().queries.length,0);
});
test('R161 loopback recipient HTTP rejects unsigned and accepts signed idempotent delivery',async()=>{
 const fixture=db(),inbox=createR161WebhookInbox({pool:fixture.pool,
  signatureSecret:secret,clock:()=>fixed});
 const server=createR161WebhookInboxServer({inbox});
 const a=await server.listen({port:0}),base='http://127.0.0.1:'+a.port;
 try{
  assert.equal((await fetch(base+'/v1/notifications/deliver',{method:'POST'})).status,413);
  const item=request();
  const success=await fetch(base+'/v1/notifications/deliver',{
   method:'POST',headers:item.headers,body:item.rawBody});
  assert.equal(success.status,202);
  assert.equal(success.headers.get('x-delivery-accepted'),'true');
  assert.equal(success.headers.get('idempotency-key'),idempotencyKey);
  assert.equal((await success.json()).productionReady,false);
  const again=await fetch(base+'/v1/notifications/deliver',{
   method:'POST',headers:item.headers,body:item.rawBody});
  assert.equal(again.status,202);
  assert.equal((await again.json()).duplicate,true);
 }finally{await server.stop();}
});
