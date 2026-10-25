#!/usr/bin/env node
/**
 * MARCOSA R49: reproducible loopback read-load proof.
 * No production addresses, credentials, real users, or external network.
 */
import {createApp} from '../server-lab/server.mjs';
import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const invite='r49-private-test-only-code';
const password='r49-disposable-password-strong';
const total=Number(process.env.MARCOSA_LOAD_READS||480);
const workers=Number(process.env.MARCOSA_LOAD_CONCURRENCY||12);
const budget=Number(process.env.MARCOSA_LOAD_P95_BUDGET_MS||1500);
if(!Number.isInteger(total)||total<100||total>1500
  ||!Number.isInteger(workers)||workers<1||workers>32
  ||!Number.isFinite(budget)||budget<1||budget>30000){
 console.error('R49 refusing invalid load settings; allowed requests 100-1500, concurrency 1-32');
 process.exit(2);
}
const app=createApp({inviteCode:invite});
let base='';
const latencies=[],byRoute={},statuses={},errors=[];
let active=0,peak=0;
async function request(path,{method='GET',cookie,body}={}){
 const headers={};
 if(cookie)headers.Cookie=cookie;
 if(method!=='GET'){headers['Content-Type']='application/json';headers.Origin=base;}
 const t=performance.now();
 const response=await fetch(base+path,{
  method,headers,
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(8000)
 });
 const data=await response.json();
 return {response,data,ms:performance.now()-t};
}
try{
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 base='http://127.0.0.1:'+app.server.address().port;
 const register=await request('/api/auth/register',{method:'POST',body:{
  username:'pilot49',email:'pilot49@example.net',password,inviteCode:invite
 }});
 assert.equal(register.response.status,201);
 const login=await request('/api/auth/login',{method:'POST',body:{email:'pilot49@example.net',password}});
 assert.equal(login.response.status,200);
 const cookie=login.response.headers.get('set-cookie')?.split(';')[0];
 assert.ok(cookie?.startsWith('marcosa_session='));
 const me=await request('/api/auth/me',{cookie});
 assert.equal(me.response.status,200);
 const world=me.data.worlds[0];
 const posts=[];
 for(let n=0;n<8;n++){
  const r=await request('/api/posts',{method:'POST',cookie,body:{
   worldId:world.id,body:'R49 local pilot story '+n+' with useful verified content',status:'published'
  }});
  assert.equal(r.response.status,201);posts.push(r.data.id);
 }
 const candidates=[
  {key:'public-feed',path:'/api/posts?limit=12'},
  {key:'public-worlds',path:'/api/worlds'},
  {key:'public-search',path:'/api/discover?q=pilot'},
  {key:'world-posts',path:'/api/worlds/'+world.slug+'/posts'},
  {key:'public-comments',path:'/api/posts/'+posts[0]+'/comments'},
  {key:'private-insights',path:'/api/me/insights',cookie},
  {key:'private-onboarding',path:'/api/me/onboarding',cookie},
  {key:'private-saved',path:'/api/me/saved',cookie},
  {key:'health',path:'/api/health'}
 ];
 for(const c of candidates){
  const r=await request(c.path,{cookie:c.cookie});
  assert.equal(r.response.status,200,c.key);
  assert.doesNotMatch(JSON.stringify(r.data),/password_hash|token_hash|code_hash/);
 }
 const unauthenticated=await request('/api/me/saved');
 assert.equal(unauthenticated.response.status,401);
 assert.equal(unauthenticated.response.headers.get('cache-control'),'no-store');
 let offset=0;
 const task=async()=>{
  while(true){
   const index=offset++;if(index>=total||errors.length)break;
   const spec=candidates[index%candidates.length];
   active++;peak=Math.max(peak,active);
   try{
    const r=await request(spec.path,{cookie:spec.cookie});
    if(r.response.status!==200)throw Error(spec.key+' status '+r.response.status);
    if(typeof r.data!=='object'||r.data===null)throw Error(spec.key+' returned non-JSON data');
    if(JSON.stringify(r.data).includes('password_hash'))throw Error('Sensitive password field in '+spec.key);
    latencies.push(r.ms);
    byRoute[spec.key]=(byRoute[spec.key]||0)+1;
    statuses[r.response.status]=(statuses[r.response.status]||0)+1;
   }catch(error){errors.push(String(error.message||error));}
   finally{active--;}
  }
 };
 const start=performance.now();
 await Promise.all(Array.from({length:workers},()=>task()));
 const elapsedMs=performance.now()-start;
 const ordered=latencies.slice().sort((a,b)=>a-b);
 const quantile=q=>ordered.length?Math.round(ordered[Math.ceil(q*ordered.length)-1]*100)/100:null;
 const report={
  version:1,kind:'disposable-local-loopback-read-smoke',production:false,
  source:'real HTTP and SQLite',gitSha:process.env.GITHUB_SHA||null,
  node:process.version,totalRequested:total,completed:latencies.length,
  failed:errors.length,concurrencyConfigured:workers,peakConcurrency:peak,
  durationMs:Math.round(elapsedMs),p50Ms:quantile(.5),p95Ms:quantile(.95),p99Ms:quantile(.99),
  budgetP95Ms:budget,routeRequests:byRoute,httpStatuses:statuses,
  externalUsers:0,measuredProductionLatency:false,
  errors:errors.slice(0,3)
 };
 mkdirSync(resolve('qa-r49'),{recursive:true});
 writeFileSync(resolve('qa-r49/local-read-load.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log('MARCOSA_R49_EVIDENCE '+JSON.stringify(report));
 assert.equal(errors.length,0,'All requests must succeed');
 assert.equal(latencies.length,total,'All scheduled requests completed');
 assert.ok(peak>1,'Concurrency must be real');
 assert.ok(report.p95Ms<=budget,'P95 local read latency exceeded budget');
}finally{
 await new Promise((done,reject)=>app.server.close(e=>e?reject(e):done()));
 app.db.close();
}
