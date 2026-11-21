/**
 * R157 isolated creator HTTP command gateway. Deliberately NOT started here.
 * Bearer-only, no Cookie auth and no deployment listener configured.
 * Real external Auth session validation and real PostgreSQL pool must be injected.
 */
import {createServer} from 'node:http';
import {IdentityError} from './identity.mjs';
import {CommandStoreError} from './pg-command-store.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowKeys=(body,keys)=>Object.keys(body).length===keys.length &&
 keys.every(k=>Object.hasOwn(body,k));
const isRev=n=>Number.isSafeInteger(n)&&n>=0;
const isTitle=s=>typeof s==='string'&&s.trim().length>0&&s.trim().length<=100;
const isDesc=s=>typeof s==='string'&&s.length<=600;
class InputError extends Error {
 constructor(message,status=400){super(message);this.name='InputError';this.status=status;}
}
function reject(message='Invalid command payload'){throw new InputError(message);}
const patterns=[
 {name:'edit',re:/^\/v1\/series\/([a-f0-9-]{36})\/edit$/i,
  build:(match,body)=>allowKeys(body,['revision','title','description'])&&isRev(body.revision)&&
   isTitle(body.title)&&isDesc(body.description)?
   {seriesId:match[1],revision:body.revision,title:body.title,description:body.description}:reject()},
 {name:'reorder',re:/^\/v1\/series\/([a-f0-9-]{36})\/reorder$/i,
  build:(match,body)=>allowKeys(body,['revision','order'])&&isRev(body.revision)&&
   Array.isArray(body.order)&&body.order.length>=1&&body.order.length<=500&&
   body.order.every(id=>typeof id==='string'&&uuid.test(id))&&
   new Set(body.order).size===body.order.length?
   {seriesId:match[1],revision:body.revision,order:body.order}:reject()},
 {name:'publish',re:/^\/v1\/series\/([a-f0-9-]{36})\/episodes$/i,
  build:(match,body)=>allowKeys(body,['revision','postId','episodeId','title'])&&
   isRev(body.revision)&&uuid.test(body.postId)&&uuid.test(body.episodeId)&&
   isTitle(body.title)?
   {seriesId:match[1],...body}:reject()},
 {name:'publication',re:/^\/v1\/series\/([a-f0-9-]{36})\/publication$/i,
  build:(match,body)=>allowKeys(body,['revision','publish'])&&
   isRev(body.revision)&&typeof body.publish==='boolean'?
   {seriesId:match[1],...body}:reject()},
 {name:'subscription',re:/^\/v1\/series\/([a-f0-9-]{36})\/subscription$/i,
  build:(match,body)=>allowKeys(body,['mode'])&&
   ['join','mute','unmute','leave'].includes(body.mode)?
   {seriesId:match[1],mode:body.mode}:reject()},
 {name:'bookmark',re:/^\/v1\/episodes\/([a-f0-9-]{36})\/bookmark$/i,
  build:(match,body)=>allowKeys(body,['save'])&&typeof body.save==='boolean'?
   {episodeId:match[1],save:body.save}:reject()},
 {name:'attendance',re:/^\/v1\/episodes\/([a-f0-9-]{36})\/attendance$/i,
  build:(match,body)=>allowKeys(body,['present'])&&typeof body.present==='boolean'?
   {episodeId:match[1],present:body.present}:reject()}
];
export const R157_ROUTES=Object.freeze(patterns.map(x=>x.name));
function route(path){
 const match=patterns.map(x=>({op:x,matched:x.re.exec(path)})).find(x=>x.matched);
 if(!match||!uuid.test(match.matched[1]))throw new InputError('Unknown endpoint',404);
 return match;
}
function write(res,status,value){
 if(res.destroyed||res.writableEnded)return;
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','content-security-policy':"default-src 'none'",
  'cross-origin-resource-policy':'same-origin'});
 res.end(JSON.stringify(value));
}
async function bodyJson(req,limit){
 const declared=req.headers['content-length'];
 if(declared!==undefined&&(!/^[0-9]+$/.test(declared)||Number(declared)>limit))
  throw new InputError('Request body too large',413);
 const mime=req.headers['content-type'];
 if(typeof mime!=='string'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(mime))
  throw new InputError('Content-Type must be application/json',415);
 let size=0,parts=[];
 for await(const chunk of req){
  size+=chunk.length;
  if(size>limit)throw new InputError('Request body too large',413);
  parts.push(chunk);
 }
 if(!size)reject();
 try{
  const text=Buffer.concat(parts).toString('utf8');
  const parsed=JSON.parse(text);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
   reject();
  return parsed;
 }catch(error){if(error instanceof InputError)throw error;reject('Malformed JSON');}
}
export function createRateLimiter({limit=24,windowMs=60000,maxEntries=2000,clock=()=>Date.now()}={}){
 if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(windowMs)||windowMs<100||
  !Number.isInteger(maxEntries)||maxEntries<1||typeof clock!=='function')
  throw Error('Invalid rate limiter settings');
 const state=new Map();
 return Object.freeze({
  allow(id){
   const now=clock(),old=state.get(id);
   if(!old||now>=old.resetAt){
    if(!old&&state.size>=maxEntries){
     for(const [key,value] of state){if(now>=value.resetAt)state.delete(key);}
     if(state.size>=maxEntries)return false;
    }
    state.set(id,{count:1,resetAt:now+windowMs});
    return true;
   }
   if(old.count>=limit)return false;
   old.count++;
   return true;
  }
 });
}
export function createCommandHttpServer({
 verifier,store,allowedOrigins,limitBytes=12288,limiter=createRateLimiter()
}={}){
 if(!verifier||typeof verifier.verifyBearer!=='function'||
  !store||typeof store.execute!=='function'||!Array.isArray(allowedOrigins)||
  allowedOrigins.length<1||allowedOrigins.length>12||
  !allowedOrigins.every(o=>typeof o==='string'&&
   (/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/i.test(o)||
    /^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(o)))||
  new Set(allowedOrigins).size!==allowedOrigins.length||
  !Number.isInteger(limitBytes)||limitBytes<256||limitBytes>65536||
  !limiter||typeof limiter.allow!=='function')
  throw Error('R157 requires explicit verifier, store, origins and bounded HTTP input');
 const allowed=new Set(allowedOrigins);
 const server=createServer(async(req,res)=>{
  try{
   const origin=req.headers.origin;
   if(typeof origin!=='string'||!allowed.has(origin))
    throw new InputError('Forbidden request origin',403);
   if(req.url==='/health'&&req.method==='GET'){
    write(res,200,{status:'isolated-lab',productionReady:false,externalDelivery:false});
    return;
   }
   if(typeof req.url!=='string'||req.url.length>180||req.url.includes('?')||
    req.url.includes('%')||req.url.includes('\\')||req.url.includes('//'))
    throw new InputError('Unknown endpoint',404);
   const command=route(req.url);
   if(req.method!=='POST')throw new InputError('Method not allowed',405);
   const header=req.headers.authorization;
   if(typeof header!=='string'||!/^Bearer [^\s]{20,8192}$/.test(header))
    throw new IdentityError();
   const identity=await verifier.verifyBearer(header.slice(7));
   if(!limiter.allow(identity.actorId))
    throw new InputError('Too many requests',429);
   const key=req.headers['x-idempotency-key'];
   if(typeof key!=='string'||!uuid.test(key))
    throw new InputError('Missing valid idempotency key',400);
   const body=await bodyJson(req,limitBytes);
   const data=command.op.build(command.matched,body);
   const response=await store.execute({actorId:identity.actorId,
    sessionId:identity.sessionId,authExpiresAt:identity.authExpiresAt,
    name:command.op.name,key,data});
   write(res,200,{ok:true,result:response});
  }catch(error){
   const status=error instanceof IdentityError?401:
    error instanceof InputError||error instanceof CommandStoreError?error.status:503;
   write(res,status,{ok:false,error:
    status===401?'Authentication required':
    status===403?'Forbidden':
    status===404?'Not found':
    status===405?'Method not allowed':
    status===413?'Request too large':
    status===415?'Unsupported content type':
    status===429?'Rate limit exceeded':
    status===400?'Invalid request':
    status===409?'Request conflicts with state':'Service unavailable'});
  }
 });
 server.requestTimeout=8000;
 server.headersTimeout=9000;
 server.keepAliveTimeout=2000;
 return server;
}
