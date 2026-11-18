/**
 * R161 staging TLS edge. Privately bound to loopback, HTTPS with pinned SNI,
 * strict Host/Origin and an allowlist of forwarded headers to R160 gateway.
 *
 * This is an ingress component, not a public reverse proxy / production WAF.
 * Terminating TLS here does not authorize external deployment.
 */
import {createServer} from 'node:https';
import {request as requestHttp} from 'node:http';
import {createSecureContext} from 'node:tls';

const reject=m=>{throw Error('R161 TLS ingress: '+m);};
const check=(v,m)=>{if(!v)reject(m);};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HOST=/^[a-z][a-z0-9.-]{3,190}$/;
const FORBIDDEN=['cookie','proxy-authorization','forwarded','x-forwarded-for',
 'x-forwarded-proto','x-forwarded-host','x-real-ip','expect','upgrade',
 'transfer-encoding','te','trailer'];
function json(res,code,message){
 if(res.headersSent||res.writableEnded)return;
 res.writeHead(code,{'content-type':'application/json','cache-control':'no-store',
  'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'",
  'strict-transport-security':'max-age=300'});
 res.end(JSON.stringify({ok:false,error:message}));
}
function isAllowedPath(path){
 return typeof path==='string'&&path.length<=180&&!path.includes('%')&&
  !path.includes('?')&&!path.includes('#')&&!path.includes('\\')&&
  !path.includes('//')&&
  (/^\/v1\/series\/[a-f0-9-]{36}\/(?:edit|reorder|episodes|publication|subscription)$/i.test(path)||
  /^\/v1\/episodes\/[a-f0-9-]{36}\/(?:bookmark|attendance)$/i.test(path));
}
export function createR161TlsIngress({
 certPem,keyPem,hostname,upstreamPort,maxBodyBytes=12288,maxConcurrent=16
}={}){
 check(typeof hostname==='string'&&HOST.test(hostname)&&hostname!=='localhost'&&
  hostname!=='127.0.0.1','operator-pinned staging hostname required');
 check(typeof certPem==='string'&&certPem.length>=200&&certPem.length<=16000&&
  typeof keyPem==='string'&&keyPem.length>=200&&keyPem.length<=16000,
  'operator-held TLS certificate and private key required');
 check(Number.isInteger(upstreamPort)&&upstreamPort>0&&upstreamPort<=65535,
  'verified loopback upstream required');
 check(Number.isInteger(maxBodyBytes)&&maxBodyBytes>=1024&&maxBodyBytes<=16384&&
  Number.isInteger(maxConcurrent)&&maxConcurrent>=1&&maxConcurrent<=64,
  'bounded ingress limits required');
 let context;
 try{context=createSecureContext({cert:certPem,key:keyPem,minVersion:'TLSv1.2'});}
 catch{reject('invalid TLS certificate or key');}
 let active=0,closed=false,listening=false;
 const counts={forwarded:0,denied:0,unavailable:0};
 const server=createServer({
  secureContext:context,cert:certPem,key:keyPem,minVersion:'TLSv1.2',
  requestCert:false,rejectUnauthorized:false
 },async(req,res)=>{
  const deny=(status,msg)=>{counts.denied++;json(res,status,msg);};
  try{
   const origin='https://'+hostname;
   const sni=req.socket.servername;
   if(sni!==hostname||req.headers.host!==hostname||
    req.headers.origin!==origin){deny(403,'Staging origin not authorized');return;}
   if(req.method!=='POST'||!isAllowedPath(req.url)){
    deny(404,'Unknown staging endpoint');return;
   }
   if(FORBIDDEN.some(k=>req.headers[k]!==undefined)){
    deny(400,'Forbidden forwarding metadata');return;
   }
   if(req.headers['content-type']!=='application/json'){
    deny(415,'JSON request required');return;
   }
   const length=req.headers['content-length'];
   if(typeof length!=='string'||!/^[0-9]{1,5}$/.test(length)||
    Number(length)<=0||Number(length)>maxBodyBytes){
    deny(413,'Bounded content-length required');return;
   }
   if(typeof req.headers.authorization!=='string'||
    !/^Bearer [^\s]{20,8192}$/.test(req.headers.authorization)||
    typeof req.headers['x-idempotency-key']!=='string'||
    !UUID.test(req.headers['x-idempotency-key'])){
    deny(401,'Verified authorization and idempotency required');return;
   }
   if(active>=maxConcurrent){deny(503,'Staging is at capacity');return;}
   active++;
   try{
    const chunks=[];let total=0;
    for await(const chunk of req){
     total+=chunk.length;
     if(total>maxBodyBytes){deny(413,'Request too large');return;}
     chunks.push(chunk);
    }
    if(total!==Number(length)){deny(400,'Content length mismatch');return;}
    const body=Buffer.concat(chunks);
    const forwardHeaders={
     'origin':origin,
     'authorization':req.headers.authorization,
     'content-type':'application/json',
     'content-length':String(body.length),
     'x-idempotency-key':req.headers['x-idempotency-key']
    };
    const upstream=await new Promise((resolve,reject)=>{
     const client=requestHttp({
      hostname:'127.0.0.1',port:upstreamPort,method:'POST',path:req.url,
      headers:forwardHeaders,timeout:7000
     },up=>{
      let size=0;const response=[];
      up.on('data',chunk=>{
       size+=chunk.length;
       if(size>65536){client.destroy(Error('Oversized upstream body'));return;}
       response.push(chunk);
      });
      up.on('end',()=>resolve({status:up.statusCode,
       type:up.headers['content-type']||'application/json',
       body:Buffer.concat(response)}));
     });
     client.on('timeout',()=>client.destroy(Error('Upstream timeout')));
     client.on('error',reject);
     client.end(body);
    });
    if(res.writableEnded||res.destroyed)return;
    counts.forwarded++;
    res.writeHead(upstream.status>=100&&upstream.status<=599?upstream.status:503,{
     'content-type':upstream.type,
     'cache-control':'no-store','x-content-type-options':'nosniff',
     'strict-transport-security':'max-age=300',
     'content-security-policy':"default-src 'none'"});
    res.end(upstream.body);
   }catch{
    counts.unavailable++;
    json(res,503,'Staging gateway unavailable');
   }finally{active--;}
  }catch{
   counts.unavailable++;json(res,503,'Staging ingress unavailable');
  }
 });
 server.requestTimeout=8000;server.headersTimeout=9000;server.keepAliveTimeout=1000;
 return Object.freeze({
  async listen({host='127.0.0.1',port=0}={}){
   check(!closed&&!listening&&host==='127.0.0.1'&&
    Number.isInteger(port)&&port>=0&&port<=65535,
    'loopback-only single listener required');
   await new Promise((ok,err)=>{
    server.once('error',err);
    server.listen(port,host,()=>{server.removeListener('error',err);ok();});
   });
   listening=true;return Object.freeze({host,port:server.address().port,
    productionReady:false});
  },
  async close(){
   if(closed)return;closed=true;
   if(listening)await new Promise(ok=>server.close(()=>ok()));
  },
  status:()=>Object.freeze({...counts,inflight:active,productionReady:false,
   privateLoopbackOnly:true})
 });
}
