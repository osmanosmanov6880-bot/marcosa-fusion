/**
 * R161 signed webhook receiver + exactly-once LOCAL acceptance by stable key.
 * No claim of exactly-once external delivery. Never processes further side effects.
 */
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyRe=/^marcosa-r159-[0-9a-f]{64}$/;
const sql=[
 'INSERT INTO marcosa_private.r161_webhook_inbox',
 '(delivery_key,episode_id,recipient_id,accepted_count)',
 'VALUES ($1::text,$2::uuid,$3::uuid,1)',
 'ON CONFLICT (delivery_key) DO UPDATE',
 'SET accepted_count=LEAST(1000000000,marcosa_private.r161_webhook_inbox.accepted_count+1)',
 'WHERE marcosa_private.r161_webhook_inbox.episode_id=EXCLUDED.episode_id',
 'AND marcosa_private.r161_webhook_inbox.recipient_id=EXCLUDED.recipient_id',
 'RETURNING accepted_count;'
].join(' ');
export const R161_WEBHOOK_INSERT_SQL=sql;
function cleanHeader(v){return typeof v==='string'&&v.length>0&&v.length<=180?v:null;}
function fail(reason='Webhook denied',status=401){
 const err=Error(reason);err.status=status;return err;
}
export function createR161WebhookInbox({pool,signatureSecret,clock=()=>Date.now(),maxSkewSeconds=120}={}){
 if(!pool||typeof pool.connect!=='function'||typeof signatureSecret!=='string'||
  signatureSecret.length<32||signatureSecret.length>256||
  typeof clock!=='function'||!Number.isInteger(maxSkewSeconds)||
  maxSkewSeconds<20||maxSkewSeconds>300)
  throw Error('R161 webhook: restricted pool and strong shared secret required');
 return Object.freeze({
  async accept({headers,rawBody}={}){
   if(!headers||!Buffer.isBuffer(rawBody)||rawBody.length<30||rawBody.length>2048)
    throw fail('Malformed signed delivery',400);
   if(headers['content-type']!=='application/json')throw fail('Wrong content type',415);
   const timestamp=cleanHeader(headers['x-marcosa-timestamp']);
   const nonce=cleanHeader(headers['x-marcosa-nonce']);
   const mac=cleanHeader(headers['x-marcosa-signature']);
   const dedupe=cleanHeader(headers['idempotency-key']);
   if(!timestamp||!/^[1-9][0-9]{9,11}$/.test(timestamp)||
    !nonce||!/^[a-f0-9]{32}$/.test(nonce)||
    !mac||!/^v1=[a-f0-9]{64}$/.test(mac)||
    !dedupe||!keyRe.test(dedupe))
    throw fail();
   const current=Math.floor(clock()/1000);
   if(Math.abs(current-Number(timestamp))>maxSkewSeconds)throw fail('Expired signature');
   const calculated=createHmac('sha256',signatureSecret)
    .update(timestamp+'\n'+nonce+'\n'+dedupe+'\n').update(rawBody).digest();
   const received=Buffer.from(mac.slice(3),'hex');
   if(received.length!==calculated.length||!timingSafeEqual(received,calculated))
    throw fail();
   let payload;
   try{payload=JSON.parse(rawBody.toString('utf8'));}catch{throw fail('Invalid event JSON',400);}
   if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    Object.keys(payload).length!==5||
    !['event','episodeId','recipientId','createdAtSeconds','deliveryAttemptIdempotencyKey']
     .every(k=>Object.hasOwn(payload,k))||
    payload.event!=='new_episode'||!uuid.test(payload.episodeId||'')||
    !uuid.test(payload.recipientId||'')||
    payload.createdAtSeconds!==Number(timestamp)||
    payload.deliveryAttemptIdempotencyKey!==dedupe)
    throw fail('Invalid signed event',400);
   const expected='marcosa-r159-'+createHash('sha256')
    .update(payload.episodeId+':'+payload.recipientId).digest('hex');
   if(dedupe!==expected)throw fail();
   let client,started=false;
   try{
    client=await pool.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
     throw Error('Invalid database client');
    await client.query('BEGIN');started=true;
    await client.query("SET LOCAL statement_timeout='3500ms'");
    await client.query('SET LOCAL ROLE marcosa_r161_webhook_receiver');
    const result=await client.query(sql,[dedupe,payload.episodeId,payload.recipientId]);
    if(result?.rows?.length!==1||
     !Number.isSafeInteger(result.rows[0].accepted_count)||result.rows[0].accepted_count<1)
     throw Error('Inbox key conflict');
    await client.query('COMMIT');started=false;
    return Object.freeze({accepted:true,idempotencyKey:dedupe,
     duplicate:result.rows[0].accepted_count>1,productionReady:false});
   }catch{
    if(client&&started)try{await client.query('ROLLBACK');}catch{}
    throw fail('Inbox storage unavailable',503);
   }finally{if(client)try{client.release();}catch{}}
  }
 });
}
export function createR161WebhookInboxServer({inbox}={}){
 if(!inbox||typeof inbox.accept!=='function')
  throw Error('R161 webhook: trusted inbox required');
 let running=false,closed=false;
 const server=createServer(async(req,res)=>{
  const write=(status,headers={},body={ok:false})=>{
   if(res.writableEnded)return;
   res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',
    'x-content-type-options':'nosniff',...headers});
   res.end(JSON.stringify(body));
  };
  if(req.socket.remoteAddress!=='127.0.0.1'||req.method!=='POST'||
   req.url!=='/v1/notifications/deliver'||req.headers.cookie||
   req.headers['transfer-encoding']){
   write(404);return;
  }
  const declared=req.headers['content-length'];
  if(typeof declared!=='string'||!/^[0-9]{1,4}$/.test(declared)||
   Number(declared)<30||Number(declared)>2048){write(413);return;}
  try{
   const parts=[];let size=0;
   for await(const chunk of req){
    size+=chunk.length;if(size>2048){write(413);return;}
    parts.push(chunk);
   }
   if(size!==Number(declared)){write(400);return;}
   const result=await inbox.accept({headers:req.headers,rawBody:Buffer.concat(parts)});
   write(202,{'idempotency-key':result.idempotencyKey,
    'x-delivery-accepted':'true'},{ok:true,duplicate:result.duplicate,
    productionReady:false});
  }catch(e){write(e?.status===503?503:e?.status===415?415:e?.status===400?400:401);}
 });
 server.requestTimeout=5000;server.headersTimeout=6000;
 return Object.freeze({
  async listen({host='127.0.0.1',port=0}={}){
   if(running||closed||host!=='127.0.0.1'||!Number.isInteger(port)||
    port<0||port>65535)throw Error('R161 webhook: loopback-only listener');
   await new Promise((ok,err)=>{
    server.once('error',err);
    server.listen(port,host,()=>{server.removeListener('error',err);ok();});
   });
   running=true;return{host,port:server.address().port,productionReady:false};
  },
  async stop(){
   if(closed)return;closed=true;
   if(running)await new Promise(ok=>server.close(()=>ok()));
  }
 });
}
