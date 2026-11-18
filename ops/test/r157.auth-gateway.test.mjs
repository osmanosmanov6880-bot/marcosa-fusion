import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createIdentityVerifier,IdentityError} from '../r157/identity.mjs';
import {createCommandStore,CommandStoreError,R157_OPERATIONS} from '../r157/pg-command-store.mjs';
import {createCommandHttpServer,createRateLimiter,R157_ROUTES} from '../r157/http-gateway.mjs';
import {assertR157Disposable,createOutboxSimulator} from '../r157/outbox-simulator.mjs';

const issuer='https://project-fixture.supabase.co/auth/v1';
const subject='15700000-0000-4157-8157-000000000001';
const session='15700000-0000-4157-8157-000000000002';
const series='15700000-0000-4157-8157-000000000101';
const episode='15700000-0000-4157-8157-000000000201';
const post='15700000-0000-4157-8157-000000000301';
const idem='15700000-0000-4157-8157-000000000401';
const now=1800000000;
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture-r157',alg:'ES256',use:'sig'};
const encoded=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const payload=()=>({iss:issuer,aud:'authenticated',sub:subject,
 role:'authenticated',session_id:session,iat:now-30,nbf:now-30,exp:now+900});
function token(claims=payload(),header={typ:'JWT',alg:'ES256',kid:'fixture-r157'}){
 const signed=encoded(header)+'.'+encoded(claims);
 return signed+'.'+sign('sha256',Buffer.from(signed),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
function verifier(active=async()=>true){
 return createIdentityVerifier({issuer,jwks:[jwk],isSessionActive:active,
  clock:()=>now*1000,maxLifetimeSeconds:3600});
}
function fakePool({onCommand,throwOnCommand}={}){
 const events=[],released=[];
 return{
  events,released,
  async connect(){
   const index=released.length;
   return{
    async query(sql,values){
     events.push({sql,values,client:index});
     if(sql.includes(' AS result')){
      if(throwOnCommand)throw throwOnCommand;
      return{rows:[{result:onCommand?onCommand(sql,values):{ok:true,actorId:values[0]}}]};
     }
     if(sql.includes('r156_claim('))return{rows:[]};
     if(sql.includes('r157_queue_health('))return{rows:[{status:{pending:0}}]};
     if(sql.includes('r157_sweep('))return{rows:[{swept:0}]};
     return{rows:[]};
    },
    release(){released.push(index);}
   };
  }
 };
}
test('R157 validates pinned ES256, exact issuer/audience/role and active session',async()=>{
 const v=verifier(async identity=>
  identity.sub===subject&&identity.sessionId===session);
 assert.deepEqual(await v.verifyBearer(token()),{
  actorId:subject,sessionId:session,authExpiresAt:now+900,issuer
 });
 for(const overrides of [
  {iss:'https://attacker.invalid'},{aud:'service_role'},{role:'service_role'},
  {session_id:'invalid'},{sub:'invalid'},{exp:now-100},{iat:now+500},
  {nbf:now+500},{exp:now+999999},{is_anonymous:true}
 ])await assert.rejects(v.verifyBearer(token({...payload(),...overrides})),IdentityError);
 await assert.rejects(verifier(async()=>false).verifyBearer(token()),IdentityError);
 await assert.rejects(verifier(async()=>{throw Error('session store offline');})
  .verifyBearer(token()),IdentityError);
});
test('R157 rejects algorithm confusion, alternate JWKS authority and tampering',async()=>{
 const v=verifier();
 for(const hd of [
  {typ:'JWT',alg:'none',kid:'fixture-r157'},
  {typ:'JWT',alg:'HS256',kid:'fixture-r157'},
  {typ:'JWT',alg:'ES256',kid:'wrong-key'},
  {typ:'JWT',alg:'ES256',kid:'fixture-r157',jku:'https://attacker.invalid/jwks'},
  {typ:'JWT',alg:'ES256',kid:'fixture-r157',crit:['b64']}
 ])await assert.rejects(v.verifyBearer(token(payload(),hd)),IdentityError);
 const valid=token();
 await assert.rejects(v.verifyBearer(valid.slice(0,-2)+'aa'),IdentityError);
 const chunks=valid.split('.');
 chunks[1]=encoded({...payload(),role:'service_role'});
 await assert.rejects(v.verifyBearer(chunks.join('.')),IdentityError);
 assert.throws(()=>createIdentityVerifier({issuer,jwks:[{...jwk,d:'secret'}],isSessionActive:()=>true}),
  /Unsafe/);
 assert.throws(()=>createIdentityVerifier({issuer,jwks:[jwk,jwk],isSessionActive:()=>true}),
  /duplicate/);
 assert.throws(()=>createIdentityVerifier({issuer,jwks:[jwk]}),/mandatory session/);
});
test('R157 parameterized store sets transaction-local role and actor then COMMIT',async()=>{
 const pool=fakePool(),store=createCommandStore({pool});
 const examples={
  edit:{seriesId:series,revision:0,title:'Hello',description:''},
  reorder:{seriesId:series,revision:1,order:[episode]},
  publish:{seriesId:series,revision:2,postId:post,episodeId:episode,title:'A'},
  publication:{seriesId:series,revision:3,publish:false},
  subscription:{seriesId:series,mode:'mute'},
  bookmark:{episodeId:episode,save:true},
  attendance:{episodeId:episode,present:false}
 };
 assert.deepEqual([...R157_OPERATIONS].sort(),Object.keys(examples).sort());
 for(const [name,data] of Object.entries(examples)){
  const result=await store.execute({actorId:subject,key:idem,name,data});
  assert.equal(result.actorId,subject);
 }
 assert.equal(pool.events.filter(x=>x.sql==='BEGIN').length,7);
 assert.equal(pool.events.filter(x=>x.sql==='COMMIT').length,7);
 assert.equal(pool.events.filter(x=>x.sql==='ROLLBACK').length,0);
 assert.equal(pool.events.filter(x=>x.sql==='SET LOCAL ROLE marcosa_r156_writer').length,7);
 assert.equal(pool.events.filter(x=>x.sql.includes("set_config('request.jwt.claim.sub")).length,7);
 assert.ok(pool.events.filter(x=>x.sql.includes(' AS result'))
  .every(x=>!x.sql.includes(subject)&&x.values[0]===subject));
 assert.equal(pool.released.length,7);
});
test('R157 failed command always ROLLBACKs and clears pooled transaction state',async()=>{
 const pool=fakePool({throwOnCommand:{code:'23505'}}),store=createCommandStore({pool});
 await assert.rejects(store.execute({actorId:subject,key:idem,name:'edit',
  data:{seriesId:series,revision:0,title:'Hi',description:''}}),e=>e.status===409);
 assert.equal(pool.events.filter(x=>x.sql==='ROLLBACK').length,1);
 assert.equal(pool.events.filter(x=>x.sql==='COMMIT').length,0);
 assert.equal(pool.released.length,1);
 await assert.rejects(store.execute({actorId:'fake',key:idem,name:'edit',data:{}}),
  e=>e.status===400);
});
test('R157 live HTTP: signed JWT, strict Origin, schema, idempotency and no cookies',async()=>{
 const pool=fakePool();
 const verify=verifier();
 const origin='http://127.0.0.1:19999';
 const server=createCommandHttpServer({
  verifier:verify,store:createCommandStore({pool}),allowedOrigins:[origin],
  limiter:createRateLimiter({limit:30,windowMs:60000})
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const url='http://127.0.0.1:'+server.address().port;
 const route='/v1/series/'+series+'/edit',authorized=token();
 async function request(path=route,{method='POST',headers={},body={revision:0,title:'New',description:''}}={}){
  const res=await fetch(url+path,{method,headers:{Origin:origin,
   'Content-Type':'application/json',Authorization:'Bearer '+authorized,
   'X-Idempotency-Key':idem,...headers},
   ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  return{status:res.status,body:await res.json()};
 }
 try{
  assert.equal((await request()).status,200);
  assert.equal((await request(route,{headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await request(route,{headers:{Authorization:'',Cookie:'session=fake'}})).status,401);
  assert.equal((await request(route,{headers:{'X-Idempotency-Key':'bad'}})).status,400);
  assert.equal((await request(route,{body:{title:'No revision',description:''}})).status,400);
  assert.equal((await request(route,{body:{revision:0,title:'valid',description:'',actorId:subject}})).status,400);
  assert.equal((await request(route,{body:'{"revision":0,"title":'}})).status,400);
  assert.equal((await request(route,{body:'{"x":"'+('a'.repeat(14000))+'"}'})).status,413);
  assert.equal((await request(route+'?x=1')).status,404);
  assert.equal((await request('/v1/series/'+series+'/reorder',{body:{revision:0,order:[episode,episode]}})).status,400);
  assert.equal((await request(route,{method:'GET'})).status,405);
  assert.deepEqual([...R157_ROUTES].sort(),[...R157_OPERATIONS].sort());
  assert.ok(pool.events.some(x=>x.sql.includes('r156_edit_series')));
 }finally{await new Promise(ok=>server.close(ok));}
});
test('R157 bounds requests and refuses untrusted listener setup',()=>{
 assert.throws(()=>createCommandHttpServer({
  verifier:verifier(),store:createCommandStore({pool:fakePool()}),
  allowedOrigins:['*']
 }),/explicit/);
 assert.throws(()=>createRateLimiter({limit:0}),/Invalid/);
 let t=0;
 const rate=createRateLimiter({limit:2,windowMs:100,maxEntries:2,clock:()=>t});
 assert.equal(rate.allow('a'),true);assert.equal(rate.allow('a'),true);
 assert.equal(rate.allow('a'),false);assert.equal(rate.allow('b'),true);
 assert.equal(rate.allow('c'),false);t=200;assert.equal(rate.allow('c'),true);
});
test('R157 outbox simulation refuses production, never calls an external transport',async()=>{
 const allowed={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
  PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'postgres',PGUSER:'postgres'};
 assert.equal(assertR157Disposable(allowed),true);
 for(const [k,v] of [['PGHOST','supabase.example'],['GITHUB_ACTIONS','false'],
   ['PGDATABASE','customers'],['GITHUB_REPOSITORY','attacker/fork']])
  assert.throws(()=>assertR157Disposable({...allowed,[k]:v}),/isolated/);
 const pool=fakePool(),s=createOutboxSimulator({pool,env:allowed});
 assert.deepEqual(await s.simulateOnce(),{
  simulationOnly:true,externalMessagesSent:0,claimed:0,acknowledged:0,cancelled:0,failed:0
 });
 assert.deepEqual(await s.health(),{pending:0});
 assert.equal(await s.sweep(),0);
 await assert.rejects(s.simulateOnce({workerId:'abc'}),/Invalid/);
});
