/**
 * R160 signed webhook delivery transport. Staging opt-in only.
 * Requires a second consent check immediately before network access.
 * Does not claim exactly-once or that arbitrary providers honor these headers.
 */
import {createHash,createHmac,randomBytes,X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const dedupe=/^marcosa-r159-[a-f0-9]{64}$/;
const fail=m=>{throw Error('R160 delivery: '+m);};
function guard(ok,msg){if(!ok)fail(msg);}
export class ConsentRevokedError extends Error{
 constructor(){super('R160 delivery: consent revoked');this.code='CONSENT_REVOKED';}
}
function validCA(pem,clock){
 guard(typeof pem==='string'&&pem.length>100&&pem.length<16000,'pinned PEM required');
 let c;
 try{c=new X509Certificate(pem);}catch{fail('invalid pinned CA');}
 guard(Date.parse(c.validFrom)<=clock()&&Date.parse(c.validTo)>clock(),'invalid CA lifetime');
}
async function defaultSendWire(url,options,body){
 return new Promise((resolve,reject)=>{
  const request=httpsRequest(url,{
   method:'POST',hostname:url.hostname,port:443,servername:url.hostname,
   ca:options.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',agent:false,
   signal:AbortSignal.timeout(options.timeoutMs),
   headers:options.headers
  },response=>{
   let bytes=0;
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>2048)request.destroy(
    Error('R160 webhook response size exceeded'));});
   response.on('end',()=>resolve({status:response.statusCode,headers:response.headers}));
  });
  request.on('error',reject);
  request.end(body);
 });
}
/**
 * For CI a transport may be injected, but a real backend defaults to https.
 * The destination, signature key, root CA and network enablement are pinned by
 * server-only operator configuration, never from an incoming request or JWT.
 */
export function createR160SignedWebhookProvider({
 endpoint,expectedHost,caPem,signatureSecret,
 allowNetwork=false,stage='staging',clock=()=>Date.now(),
 sendWire=defaultSendWire,timeoutMs=3500
}={}){
 guard(stage==='staging','production delivery is not enabled');
 guard(typeof endpoint==='string'&&endpoint.length<300,'pinned endpoint required');
 let url;
 try{url=new URL(endpoint);}catch{fail('invalid endpoint');}
 guard(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&
  (url.port===''||url.port==='443')&&url.pathname==='/v1/notifications/deliver',
  'pinned HTTPS endpoint required');
 guard(typeof expectedHost==='string'&&expectedHost===url.hostname&&
  /^[a-z0-9][a-z0-9.-]{3,250}$/i.test(expectedHost)&&
  !/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(expectedHost),
  'public, explicitly pinned provider host required');
 guard(typeof signatureSecret==='string'&&signatureSecret.length>=32&&
  signatureSecret.length<=256&&!/\s/.test(signatureSecret),
  'strong server-held signing secret required');
 guard(typeof clock==='function'&&typeof sendWire==='function'&&
  Number.isInteger(timeoutMs)&&timeoutMs>=500&&timeoutMs<=7000,
  'bounded HTTPS transport required');
 validCA(caPem,clock);
 return Object.freeze({
  supportsIdempotency:true,supportsRecipientRecheck:true,
  async send({episodeId,recipientId,idempotencyKey,consentFenceConfirmedAtMs,deliveryFence}={}){
   guard(allowNetwork===true,'external network side effects explicitly disabled');
   guard(uuid.test(episodeId||'')&&uuid.test(recipientId||'')&&
    dedupe.test(idempotencyKey||''),'invalid notification identifiers');
   const age=clock()-consentFenceConfirmedAtMs;
   guard(Number.isFinite(age)&&age>=0&&age<=5000,'expired consent preflight');
   guard(typeof deliveryFence==='function','per-lease recheck callback required');
   // The provider rechecks the SAME lease immediately before sending.
   let allowed=false;
   try{allowed=await deliveryFence()===true;}catch{}
   if(!allowed)throw new ConsentRevokedError();
   const now=clock(),timestamp=Math.floor(now/1000);
   const nonce=randomBytes(16).toString('hex');
   const payload=JSON.stringify({event:'new_episode',episodeId,recipientId,
    createdAtSeconds:timestamp,deliveryAttemptIdempotencyKey:idempotencyKey});
   const mac=createHmac('sha256',signatureSecret)
    .update(timestamp+'\n'+nonce+'\n'+idempotencyKey+'\n'+payload).digest('hex');
   const headers={
    'content-type':'application/json','content-length':Buffer.byteLength(payload),
    'idempotency-key':idempotencyKey,'x-marcosa-timestamp':String(timestamp),
    'x-marcosa-nonce':nonce,'x-marcosa-signature':'v1='+mac
   };
   let result;
   try{result=await sendWire(url,{headers,ca:caPem,timeoutMs},payload);}
   catch{fail('HTTPS delivery not confirmed');}
   // Redirects or empty 2xx are NOT evidence of accepting a stable dedupe key.
   if(result?.status!==202||
    result.headers?.['idempotency-key']!==idempotencyKey||
    result.headers?.['x-delivery-accepted']!=='true')
    fail('HTTPS recipient did not acknowledge idempotency');
   return Object.freeze({accepted:true,provider:'signed-webhook',productionReady:false});
  },
  publicStatus:()=>Object.freeze({stage:'staging',destinationHost:expectedHost,
   networkEnabled:allowNetwork,productionReady:false,externalProviderCertified:false})
 });
}
