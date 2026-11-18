/**
 * R159: consent-fenced leased outbox worker.
 *
 * No delivery provider is built into the repo. A provider must implement
 * stable idempotency and recheck recipient permission immediately before its
 * external side effect. External delivery is AT-LEAST-ONCE, not exactly once.
 */
import {createHash} from 'node:crypto';
const must=(value,msg)=>{if(!value)throw Error('R159 delivery: '+msg);};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const asId=value=>{must(typeof value==='string'&&uuid.test(value),'invalid episode or recipient identifier');return value;};
const queueId=value=>{
 const str=String(value);must(/^[1-9][0-9]{0,17}$/.test(str),'invalid queue id');return str;
};
/** Connection and role are transaction-local even if a connection is reused. */
export function createPgDispatcherStore({pool}={}){
 must(pool&&typeof pool.connect==='function','restricted dispatcher pool required');
 async function query(sql,params=[],kind='rows'){
  let client,started=false;
  try{
   client=await pool.connect();
   must(client&&typeof client.query==='function'&&typeof client.release==='function',
    'trusted transaction client required');
   await client.query('BEGIN');started=true;
   await client.query("SET LOCAL statement_timeout='4000ms'");
   await client.query('SET LOCAL ROLE marcosa_r156_dispatcher');
   const result=await client.query(sql,params);
   must(result&&Array.isArray(result.rows),'malformed dispatcher query');
   await client.query('COMMIT');started=false;
   if(kind==='boolean')return result.rows.length===1&&result.rows[0].allowed===true;
   return result.rows;
  }catch{
   if(client&&started)try{await client.query('ROLLBACK');}catch{}
   throw Error('R159 dispatcher SQL unavailable');
  }finally{if(client)try{client.release();}catch{}}
 }
 return Object.freeze({
  claim:({workerId,limit=10,leaseSeconds=60})=>{
   must(typeof workerId==='string'&&/^[a-z][a-z0-9_-]{3,39}$/.test(workerId),'invalid worker id');
   must(Number.isInteger(limit)&&limit>=1&&limit<=20,'bounded claim batch required');
   must(Number.isInteger(leaseSeconds)&&leaseSeconds>=20&&leaseSeconds<=300,'bounded lease required');
   return query('SELECT * FROM marcosa_private.r156_claim($1::text,$2::integer,$3::integer)',[workerId,limit,leaseSeconds]);
  },
  allowed:({id,token})=>query(
   'SELECT marcosa_private.r157_delivery_fence($1::bigint,$2::uuid) AS allowed',
   [queueId(id),asId(token)],'boolean'),
  ack:async({id,token})=>{
   const r=await query('SELECT marcosa_private.r156_ack($1::bigint,$2::uuid) AS allowed',
    [queueId(id),asId(token)]);
   return r.length===1&&r[0].allowed===true;
  },
  cancel:async({id,token})=>{
   const r=await query('SELECT marcosa_private.r157_cancel($1::bigint,$2::uuid) AS allowed',
    [queueId(id),asId(token)]);
   return r.length===1&&r[0].allowed===true;
  },
  nack:async({id,token})=>{
   const r=await query('SELECT marcosa_private.r156_nack($1::bigint,$2::uuid) AS allowed',
    [queueId(id),asId(token)]);
   return r.length===1&&r[0].allowed===true;
  },
  sweep:async(limit=100)=>{
   must(Number.isInteger(limit)&&limit>=1&&limit<=200,'bounded sweep required');
   const r=await query('SELECT marcosa_private.r157_sweep($1::integer) AS swept',[limit]);
   return r.length===1?Number(r[0].swept)||0:0;
  }
 });
}
export function createConsentFencedWorker({
 dispatcher,provider,workerId='marcosa_r159_worker',batchSize=10,
 clock=()=>Date.now(),logger=()=>{}
}={}){
 must(dispatcher&&['claim','allowed','ack','cancel','nack'].every(name=>typeof dispatcher[name]==='function'),
  'trusted dispatcher is required');
 must(provider&&provider.supportsIdempotency===true&&
  provider.supportsRecipientRecheck===true&&typeof provider.send==='function',
  'delivery provider must guarantee stable keys and recheck consent');
 must(/^[a-z][a-z0-9_-]{3,39}$/.test(workerId),'invalid worker identity');
 must(Number.isInteger(batchSize)&&batchSize>=1&&batchSize<=20,'bounded work batch required');
 must(typeof clock==='function'&&typeof logger==='function','clock and redacted logger required');
 let running=false;
 const event=(kind)=>{try{logger(Object.freeze({event:'r159_delivery_'+kind}));}catch{}};
 return Object.freeze({
  async runOnce(){
   if(running)throw Error('R159 delivery: concurrent run on one worker refused');
   running=true;
   const counts={claimed:0,sent:0,revoked:0,retried:0,uncertain:0};
   try{
    const tasks=await dispatcher.claim({workerId,limit:batchSize,leaseSeconds:60});
    must(Array.isArray(tasks)&&tasks.length<=batchSize,'invalid claim result');
    counts.claimed=tasks.length;
    for(const task of tasks){
     const id=queueId(task.id),token=asId(task.lease_token);
     const episodeId=asId(task.episode_id),recipientId=asId(task.user_id);
     // Stable provider dedupe key must survive a new lease token on retry.
     const idempotencyKey='marcosa-r159-'+createHash('sha256')
      .update(episodeId+':'+recipientId).digest('hex');
     let allowed=false;
     try{allowed=await dispatcher.allowed({id,token});}catch{}
     if(!allowed){
      try{await dispatcher.cancel({id,token});}catch{}
      counts.revoked++;event('revoked');continue;
     }
     try{
      const result=await provider.send({
       episodeId,recipientId,idempotencyKey,
       consentFenceConfirmedAtMs:clock(),
       deliveryFence:()=>dispatcher.allowed({id,token})
      });
      if(!result||result.accepted!==true)throw Error('Provider did not acknowledge acceptance');
      if(await dispatcher.ack({id,token})){counts.sent++;event('acked');}
      else{counts.uncertain++;event('unconfirmed');}
     }catch(error){
      if(error?.code==='CONSENT_REVOKED'){
       try{await dispatcher.cancel({id,token});}catch{}
       counts.revoked++;event('revoked');continue;
      }
      try{await dispatcher.nack({id,token});}catch{}
      counts.retried++;event('retry');
     }
    }
    return Object.freeze(counts);
   }finally{running=false;}
  }
 });
}
