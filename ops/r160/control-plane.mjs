/**
 * R160 loopback-only control plane for STAGING.
 * Separate socket from authenticated creator command gateway. No UI, no PII.
 * /ready never implies production deploy or external financial readiness.
 */
import {createServer} from 'node:http';
import {timingSafeEqual,createHash} from 'node:crypto';

const matchSecret=(expected,actual)=>{
 if(typeof actual!=='string'||actual.length!==expected.length)return false;
 const a=createHash('sha256').update(expected).digest();
 const b=createHash('sha256').update(actual).digest();
 return timingSafeEqual(a,b);
};
function response(res,status,body){
 if(res.writableEnded)return;
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'",
  'Cross-Origin-Resource-Policy':'same-origin'});
 res.end(JSON.stringify(body));
}
export function createR160ControlPlane({runtime,adminToken}={}){
 if(!runtime||typeof runtime.preflight!=='function'||
  typeof runtime.stop!=='function'||typeof runtime.status!=='function')
  throw Error('R160 control: validated staging runtime required');
 if(typeof adminToken!=='string'||adminToken.length<32||adminToken.length>128||
  !/^[A-Za-z0-9_.~-]+$/.test(adminToken))
  throw Error('R160 control: server-only random admin token required');
 let running=false,closed=false,mutating=false;
 const counters={preflightAttempts:0,preflightFailures:0,drainCalls:0,deniedAdminRequests:0};
 const metrics=()=>Object.freeze({...counters,productionReady:false});
 const api=createServer(async(req,res)=>{
  const local=req.socket.remoteAddress==='127.0.0.1';
  if(!local){response(res,403,{ok:false,error:'Loopback only'});return;}
  if(req.url==='/live'&&req.method==='GET'){
   response(res,closed?503:200,{service:'marcosa-staging-control',alive:!closed,productionReady:false});
   return;
  }
  if(req.url==='/ready'&&req.method==='GET'){
   const s=runtime.status();
   response(res,s.ready?200:503,{ready:s.ready,tier:'staging',
    state:s.state,productionReady:false});
   return;
  }
  const bearer=req.headers.authorization;
  const authorized=typeof bearer==='string'&&bearer.startsWith('Bearer ')&&
   matchSecret(adminToken,bearer.slice(7));
  if(!authorized){
   counters.deniedAdminRequests++;
   response(res,401,{ok:false,error:'Operator authentication required'});return;
  }
  if(req.url==='/metrics'&&req.method==='GET'){
   response(res,200,metrics());return;
  }
  if(!['/preflight','/drain'].includes(req.url)||req.method!=='POST'){
   response(res,404,{ok:false,error:'Unknown control endpoint'});return;
  }
  if(req.headers.origin||req.headers.cookie||req.headers['content-length']!=='0'){
   response(res,400,{ok:false,error:'Operator request must be bodyless and cookie-free'});return;
  }
  if(mutating){
   response(res,409,{ok:false,error:'Control action already running'});return;
  }
  mutating=true;
  try{
   if(req.url==='/preflight'){
    counters.preflightAttempts++;
    try{
     await runtime.preflight();
     response(res,200,{ok:true,readiness:runtime.status()});
    }catch{
     counters.preflightFailures++;
     response(res,503,{ok:false,error:'Preflight denied',productionReady:false});
    }
   }else{
    counters.drainCalls++;
    await runtime.stop();
    response(res,200,{ok:true,state:'drained',productionReady:false});
   }
  }catch{
   response(res,503,{ok:false,error:'Control action unavailable',productionReady:false});
  }finally{mutating=false;}
 });
 api.requestTimeout=4000;
 api.headersTimeout=5000;
 api.keepAliveTimeout=1000;
 return Object.freeze({
  async listen({port=0,host='127.0.0.1'}={}){
   if(closed||running||host!=='127.0.0.1'||
    !Number.isInteger(port)||port<0||port>65535)
    throw Error('R160 control: loopback-only single bind required');
   await new Promise((resolve,reject)=>{
    api.once('error',reject);
    api.listen(port,host,()=>{api.removeListener('error',reject);resolve();});
   });
   running=true;
   return{host,port:api.address().port};
  },
  async close(){
   if(closed)return;
   closed=true;
   if(running){await new Promise(resolve=>api.close(()=>resolve()));running=false;}
  },
  metrics
 });
}
