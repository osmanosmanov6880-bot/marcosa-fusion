import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {X509Certificate,createHash,createHmac} from 'node:crypto';
import {createR160SignedWebhookProvider,ConsentRevokedError} from '../r160/webhook-provider.mjs';
import {createConsentFencedWorker} from '../r159/outbox-worker.mjs';
const ca=rootCertificates.find(s=>{try{const c=new X509Certificate(s),n=Date.now();
 return Date.parse(c.validFrom)<=n&&n<Date.parse(c.validTo);}catch{return false;}});
assert.ok(ca);
const id='16000000-0000-4160-8160-000000000001';
const user='16000000-0000-4160-8160-000000000002';
const key='marcosa-r159-'+createHash('sha256').update(id+':'+user).digest('hex');
const secret='r160-ci-only-long-random-example-signed-webhook-secret';
const config=()=>({endpoint:'https://notify.staging.example/v1/notifications/deliver',
 expectedHost:'notify.staging.example',caPem:ca,signatureSecret:secret});
test('R160 signs and confirms an idempotent HTTPS notification after consent fence',async()=>{
 const calls=[];
 const provider=createR160SignedWebhookProvider({...config(),allowNetwork:true,
  sendWire:async(url,opts,body)=>{
   calls.push({url,opts,body});
   return{status:202,headers:{'idempotency-key':opts.headers['idempotency-key'],
    'x-delivery-accepted':'true'}};
  }});
 let checks=0;
 const outcome=await provider.send({episodeId:id,recipientId:user,idempotencyKey:key,
  consentFenceConfirmedAtMs:Date.now(),deliveryFence:async()=>{checks++;return true;}});
 assert.equal(outcome.accepted,true);assert.equal(checks,1);
 assert.equal(calls.length,1);
 const q=calls[0],h=q.opts.headers,t=h['x-marcosa-timestamp'],n=h['x-marcosa-nonce'];
 assert.equal(q.url.hostname,'notify.staging.example');
 assert.equal(h['idempotency-key'],key);
 assert.equal(h['x-marcosa-signature'],'v1='+createHmac('sha256',secret)
  .update(t+'\n'+n+'\n'+key+'\n'+q.body).digest('hex'));
 assert.doesNotMatch(JSON.stringify(provider.publicStatus()),/secret|BEGIN CERTIFICATE/);
});
test('R160 denies network without explicit opt-in, bad destination, weak key or missing lease fence',async()=>{
 for(const change of [
  {endpoint:'http://notify.staging.example/v1/notifications/deliver'},
  {endpoint:'https://notify.staging.example/evil'},
  {endpoint:'https://notify.staging.example/v1/notifications/deliver?redirect=evil'},
  {expectedHost:'attacker.staging.example'},{signatureSecret:'short'},
  {caPem:'BAD'},{stage:'production'}
 ])assert.throws(()=>createR160SignedWebhookProvider({...config(),...change}),/R160 delivery/);
 const p=createR160SignedWebhookProvider(config());
 await assert.rejects(p.send({episodeId:id,recipientId:user,idempotencyKey:key,
  consentFenceConfirmedAtMs:Date.now(),deliveryFence:async()=>true}),/explicitly disabled/);
 const enabled=createR160SignedWebhookProvider({...config(),allowNetwork:true,
  sendWire:async()=>{throw Error('send must not happen');}});
 await assert.rejects(enabled.send({episodeId:id,recipientId:user,idempotencyKey:key,
  consentFenceConfirmedAtMs:Date.now(),deliveryFence:async()=>false}),
   err=>err instanceof ConsentRevokedError&&err.code==='CONSENT_REVOKED');
});
test('R160 revocation between claim and HTTPS send cancels lease with zero transmissions',async()=>{
 const task={id:1,episode_id:id,user_id:user,lease_token:'16000000-0000-4160-8160-000000000003'};
 const calls=[],cancels=[],allowed=[true,false];
 const dispatcher={claim:async()=>[task],allowed:async()=>allowed.shift(),
  cancel:async x=>{cancels.push(x);return true;},nack:async()=>true,ack:async()=>true};
 const provider=createR160SignedWebhookProvider({...config(),allowNetwork:true,
  sendWire:async()=>{calls.push(1);return{status:202,headers:{'idempotency-key':key,
   'x-delivery-accepted':'true'}};}});
 const worker=createConsentFencedWorker({dispatcher,provider,workerId:'r160_worker'});
 const counts=await worker.runOnce();
 assert.equal(counts.claimed,1);assert.equal(counts.revoked,1);assert.equal(counts.sent,0);
 assert.equal(counts.retried,0);assert.equal(calls.length,0);assert.equal(cancels.length,1);
});
test('R160 rejects redirect, wrong idempotency acknowledgement and uncertain outcome',async()=>{
 for(const result of [{status:302,headers:{}},
  {status:202,headers:{'idempotency-key':'other','x-delivery-accepted':'true'}},
  {status:200,headers:{'idempotency-key':key,'x-delivery-accepted':'true'}}]){
  const provider=createR160SignedWebhookProvider({...config(),allowNetwork:true,
   sendWire:async()=>result});
  await assert.rejects(provider.send({episodeId:id,recipientId:user,idempotencyKey:key,
   consentFenceConfirmedAtMs:Date.now(),deliveryFence:async()=>true}),/did not acknowledge/);
 }
});
