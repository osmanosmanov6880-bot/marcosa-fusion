/**
 * R167 staging-only HTTPS immutable object transport, not a real connected
 * cloud storage account. No redirects, mutable overwrites or implicit retries.
 * A remote provider must independently guarantee write-once behavior.
 */
import {request as httpsRequest} from 'node:https';
import {X509Certificate,createHash,timingSafeEqual} from 'node:crypto';
const H64=/^[a-f0-9]{64}$/;
const MAGIC=Buffer.from('MARCOSA-R165-BACKUP-V1\n');
const MAX=25*1024*1024+2048;
const fail=m=>{throw Error('R167 remote object: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function defaultWire(url,{method,headers,body,caPem,timeoutMs}){
 return new Promise((resolve,reject)=>{
  const req=httpsRequest(url,{
   method,headers,ca:caPem,rejectUnauthorized:true,
   minVersion:'TLSv1.2',servername:url.hostname,agent:false,
   signal:AbortSignal.timeout(timeoutMs)
  },res=>{
   const pieces=[];let length=0;
   res.on('data',chunk=>{
    length+=chunk.length;
    if(length>MAX)req.destroy(Error('R167 oversized remote response'));
    else pieces.push(chunk);
   });
   res.on('end',()=>resolve({status:res.statusCode,
    headers:res.headers,body:Buffer.concat(pieces)}));
  });
  req.on('error',reject);
  req.end(body);
 });
}
export function createR167RemoteObjectStore({origin,expectedHost,caPem,token,
 allowNetwork=false,stage='synthetic-ci',ciLoopback=false,
 clock=()=>Date.now(),sendWire=defaultWire,timeoutMs=5500}={}){
 ok(stage==='synthetic-ci','only isolated staging rehearsal enabled');
 let u;
 try{u=new URL(origin);}catch{fail('invalid HTTPS origin');}
 ok(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&
  u.pathname==='/v1/archives/'&&u.hostname===expectedHost&&
  typeof expectedHost==='string'&&expectedHost.length<=253&&
  /^[a-z0-9][a-z0-9.-]+$/i.test(expectedHost),
  'exact pinned provider hostname and path required');
 const local=/^(localhost|127\.0\.0\.1)$/.test(expectedHost);
 ok(!local||(ciLoopback&&process.env.GITHUB_ACTIONS==='true'),
  'loopback TLS transport only permitted in disposable GitHub CI');
 ok(!local?(u.port===''||u.port==='443'):
  (Number.isInteger(Number(u.port))&&Number(u.port)>=1&&Number(u.port)<=65535),
  'only pinned HTTPS endpoint port allowed');
 ok(typeof caPem==='string'&&caPem.length>100&&caPem.length<16000,
  'pinned X509 issuer certificate required');
 try{
  const ca=new X509Certificate(caPem),now=clock();
  ok(Date.parse(ca.validFrom)<=now&&now<Date.parse(ca.validTo),
   'certificate is expired or not yet valid');
 }catch(e){fail('invalid or expired pinned certificate');}
 ok(typeof token==='string'&&token.length>=48&&token.length<=256&&
  /^[A-Za-z0-9._-]+$/.test(token),'server-only strong access token required');
 ok(typeof sendWire==='function'&&typeof clock==='function'&&
  Number.isInteger(timeoutMs)&&timeoutMs>=500&&timeoutMs<=7000,
  'bounded HTTP transport required');
 function target(digest){
  ok(H64.test(digest||''),'only content-addressed SHA256 keys allowed');
  return new URL(digest+'.r165enc',u);
 }
 function authHeaders(digest){
  return Object.freeze({authorization:'Bearer '+token,
   'x-content-sha256':digest,'accept':'application/vnd.marcosa.r165enc'});
 }
 async function putEncrypted({blob,sha256}={}){
  ok(allowNetwork===true,'outbound transfer disabled without operator opt-in');
  ok(Buffer.isBuffer(blob)&&blob.length>700&&blob.length<=MAX&&
   blob.subarray(0,MAGIC.length).equals(MAGIC),
   'R165 AES-GCM ciphertext required');
  const digest=sha(blob);
  ok(sha256===digest,'expected digest changed before upload');
  let response;
  try{
   response=await sendWire(target(digest),{method:'PUT',caPem,timeoutMs,
    headers:{...authHeaders(digest),'if-none-match':'*',
     'content-type':'application/vnd.marcosa.r165enc',
     'content-length':String(blob.length)},body:blob});
  }catch{fail('write-once HTTPS upload unconfirmed');}
  ok(response?.status===201&&response.headers?.['x-content-sha256']===digest&&
   response.headers?.['x-write-once']==='true'&&
   Buffer.isBuffer(response.body)&&response.body.length<=1024,
   'remote immutable receipt missing; no retry after ambiguous outcome');
  return Object.freeze({sha256:digest,bytes:blob.length,immutableReceipt:true,
   providerIndependentlyAudited:false,productionAuthorized:false});
 }
 async function getEncrypted({sha256}={}){
  ok(allowNetwork===true,'outbound transfer disabled without operator opt-in');
  const dest=target(sha256);let res;
  try{res=await sendWire(dest,{method:'GET',caPem,timeoutMs,
   headers:authHeaders(sha256),body:null});}
  catch{fail('HTTPS readback unavailable');}
  ok(res?.status===200&&res.headers?.['x-content-sha256']===sha256&&
   res.headers?.['content-type']==='application/vnd.marcosa.r165enc'&&
   Buffer.isBuffer(res.body)&&res.body.length>700&&res.body.length<=MAX&&
   res.body.subarray(0,MAGIC.length).equals(MAGIC),
   'no trusted complete remote ciphertext readback');
  const expected=Buffer.from(sha256,'hex'),actual=Buffer.from(sha(res.body),'hex');
  ok(timingSafeEqual(expected,actual),'remote blob changed or truncated');
  return Object.freeze({blob:res.body,sha256,verifiedContentAddress:true,
   independentProviderReadback:true,productionAuthorized:false});
 }
 return Object.freeze({putEncrypted,getEncrypted,
  publicStatus:()=>Object.freeze({stage:'synthetic-ci',providerHost:expectedHost,
   remoteEnabled:allowNetwork,independentProviderVerified:false,
   productionAuthorized:false})});
}
