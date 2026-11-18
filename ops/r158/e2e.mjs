/**
 * R158 REAL PostgreSQL 17 + REAL HTTP integration acceptance, CI-only.
 * Locally signed synthetic ES256 JWT, isolated PostgreSQL session revocation,
 * least-privileged login role, all seven command routes, no external delivery.
 */
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createIdentityVerifier} from '../r157/identity.mjs';
import {createCommandHttpServer,createRateLimiter} from '../r157/http-gateway.mjs';
import {createR158CommandStore,createR158SessionChecker,requireR158Disposable} from './psql-command-adapter.mjs';

const OWNER='15800000-0000-4158-8158-000000000001';
const READER='15800000-0000-4158-8158-000000000002';
const STRANGER='15800000-0000-4158-8158-000000000003';
const SEASON='15800000-0000-4158-8158-000000000301';
const FIRST='15800000-0000-4158-8158-000000000401';
const SECOND='15800000-0000-4158-8158-000000000402';
const POST='15800000-0000-4158-8158-000000000202';
const SESSIONS={
 [OWNER]:'15800000-0000-4158-8158-000000000501',
 [READER]:'15800000-0000-4158-8158-000000000502',
 [STRANGER]:'15800000-0000-4158-8158-000000000503'
};
const expected=(condition,message)=>{if(!condition)throw Error('R158 acceptance: '+message);};
function rootSql(sql){
 requireR158Disposable();
 expected(process.env.R158_POSTGRES_ADMIN_PASSWORD==='r158-ci-disposable-only',
  'Disposable PostgreSQL operator password must match synthetic fixture');
 const done=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',timeout:9000,
   env:{PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'postgres',
    PGUSER:'postgres',PGPASSWORD:process.env.R158_POSTGRES_ADMIN_PASSWORD,PGCONNECT_TIMEOUT:'3'}});
 expected(done.status===0,'Privileged synthetic SQL fixture check failed');
 return done.stdout.trim();
}
const issuer='https://r158-synthetic-id.example.invalid/auth/v1';
const now=Math.floor(Date.now()/1000);
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk={...publicKey.export({format:'jwk'}),kid:'r158-ephemeral-test-key',alg:'ES256',use:'sig'};
const encoded=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function jwt(user,overrides={},header={typ:'JWT',alg:'ES256',kid:jwk.kid}){
 const claims={iss:issuer,aud:'authenticated',role:'authenticated',sub:user,
  session_id:SESSIONS[user],iat:now-30,nbf:now-30,exp:now+600,...overrides};
 const signingInput=encoded(header)+'.'+encoded(claims);
 return signingInput+'.'+sign('sha256',Buffer.from(signingInput),
  {key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
const serverOrigin='http://127.0.0.1:41588';
export async function runR158EndToEnd(){
 requireR158Disposable();
 const store=createR158CommandStore(),isSessionActive=createR158SessionChecker();
 const verifier=createIdentityVerifier({issuer,jwks:[jwk],isSessionActive,
  clock:()=>Date.now(),maxLifetimeSeconds:3600});
 const server=createCommandHttpServer({verifier,store,allowedOrigins:[serverOrigin],
  limiter:createRateLimiter({limit:150,windowMs:60000})});
 await new Promise((ok,fail)=>{
  server.once('error',fail);server.listen(41588,'127.0.0.1',ok);
 });
 async function call(path,user,body,key=randomUUID(),{origin=serverOrigin,token}={}){
  const resp=await fetch(serverOrigin+path,{method:'POST',
   headers:{Origin:origin,Authorization:'Bearer '+(token||jwt(user)),
    'X-Idempotency-Key':key,'Content-Type':'application/json'},
   body:JSON.stringify(body)});
  return{status:resp.status,body:await resp.json()};
 }
 const route='/v1/series/'+SEASON;
 try{
  const health=await fetch(serverOrigin+'/health',{headers:{Origin:serverOrigin}});
  expected(health.status===200 && (await health.json()).productionReady===false,
   'HTTP health readiness must be false');
  const noOrigin=await call(route+'/edit',OWNER,
   {revision:0,title:'Unauthorised origin',description:''},randomUUID(),
   {origin:'https://attacker.example.invalid'});
  expected(noOrigin.status===403,'Cross-origin request must fail');
  const invalid=await call(route+'/edit',OWNER,
   {revision:0,title:'Attack',description:''},randomUUID(),
   {token:jwt(OWNER,{role:'service_role'})});
  expected(invalid.status===401,'Service-role bearer token was accepted');

  const joined=await call(route+'/subscription',READER,{mode:'join'});
  expected(joined.status===200&&joined.body.result.subscribed===true,'Reader join failed');
  const editKey=randomUUID();
  const editPayload={revision:0,title:"R158: author's real PostgreSQL",description:"Live CI transaction; no production"};
  const first=await call(route+'/edit',OWNER,editPayload,editKey);
  expected(first.status===200&&first.body.result.revision===1,'Owner first edit failed');
  const replay=await call(route+'/edit',OWNER,editPayload,editKey);
  expected(replay.status===200&&JSON.stringify(replay.body.result)===JSON.stringify(first.body.result),
   'Idempotent retry was not preserved');
  const replayDifferent=await call(route+'/edit',OWNER,{...editPayload,title:'Changed reuse'},editKey);
  expected(replayDifferent.status!==200,'Changing payload of existing key succeeded');
  const forged=await call(route+'/edit',READER,{revision:1,title:'Reader takeover',description:''});
  expected(forged.status!==200,'Reader could edit foreign season');
  const reordered=await call(route+'/reorder',OWNER,{revision:1,order:[FIRST]});
  expected(reordered.status===200&&reordered.body.result.revision===2,'Real episode reorder failed');
  const published=await call(route+'/episodes',OWNER,
   {revision:2,postId:POST,episodeId:SECOND,title:'Real PostgreSQL episode'});
  expected(published.status===200&&published.body.result.revision===3&&
   published.body.result.notificationJobs===1,'New episode did not queue exact one notification');
  const saved=await call('/v1/episodes/'+SECOND+'/bookmark',READER,{save:true});
  expected(saved.status===200&&saved.body.result.saved===true,'Real reader bookmark failed');
  const marked=await call('/v1/episodes/'+SECOND+'/attendance',READER,{present:true});
  expected(marked.status===200&&marked.body.result.present===true,'Opt-in mark failed');

  // Two real independent HTTP requests spawn two separate PostgreSQL sessions.
  const races=await Promise.all([
   call(route+'/edit',OWNER,{revision:3,title:'R158 concurrent winner A',description:'Lock A'}),
   call(route+'/edit',OWNER,{revision:3,title:'R158 concurrent winner B',description:'Lock B'})
  ]);
  expected(races.filter(x=>x.status===200).length===1,
   'Optimistic concurrency did not permit exactly one writer');
  expected(races.filter(x=>x.status!==200).length===1,
   'Competing stale revision did not fail');
  const hidden=await call(route+'/publication',OWNER,{revision:4,publish:false});
  expected(hidden.status===200&&hidden.body.result.published===false,
   'Archived season state failed');
  const addAfterArchive=await call('/v1/episodes/'+SECOND+'/bookmark',STRANGER,{save:true});
  expected(addAfterArchive.status!==200,'Stranger saved archived chapter');
  const withdrawn=await call('/v1/episodes/'+SECOND+'/attendance',READER,{present:false});
  expected(withdrawn.status===200&&withdrawn.body.result.present===false,
   'Reader could not withdraw personal consent after archive');
  const unsaved=await call('/v1/episodes/'+SECOND+'/bookmark',READER,{save:false});
  expected(unsaved.status===200&&unsaved.body.result.saved===false,
   'Reader could not delete private bookmark');
  const beforeRevoke=rootSql("SELECT count(*) FROM marcosa_private.r156_commands WHERE actor_id='"+READER+"';");
  rootSql("UPDATE marcosa_private.r158_sessions SET revoked_at=clock_timestamp() "+
   "WHERE user_id='"+READER+"' AND session_id='"+SESSIONS[READER]+"';");
  const revoked=await call(route+'/subscription',READER,{mode:'leave'});
  expected(revoked.status===401,'Revoked session permitted another HTTP mutation');
  const afterRevoke=rootSql("SELECT count(*) FROM marcosa_private.r156_commands WHERE actor_id='"+READER+"';");
  expected(beforeRevoke===afterRevoke,'Revocation still modified trusted command ledger');
  const brokenSession=createR158SessionChecker({env:{...process.env,PGPASSWORD:'invalid-loopback-key'}});
  expected(await brokenSession({sub:OWNER,sessionId:SESSIONS[OWNER],expiresAt:now+600})===false,
   'Disconnected session store must fail closed');
  const summary=rootSql("SELECT concat("+
   "(SELECT revision FROM public.marcosa_seasons WHERE id='"+SEASON+"'),':',"+
   "(SELECT count(*) FROM public.marcosa_season_audit WHERE series_id='"+SEASON+"'),':',"+
   "(SELECT count(*) FROM public.marcosa_season_subscriptions WHERE series_id='"+SEASON+"'),':',"+
   "(SELECT count(*) FROM public.marcosa_season_attendance WHERE episode_id='"+SECOND+"'),':',"+
   "(SELECT count(*) FROM public.marcosa_season_bookmarks WHERE episode_id='"+SECOND+"'))");
  expected(summary==='5:5:1:0:0','Committed PostgreSQL state mismatched: '+summary);
  console.log('R158_REAL_SIGNED_HTTP_TO_POSTGRES=PASS');
  console.log('R158_IDEMPOTENCY_CONCURRENT_REVOCATION_AND_ROLLBACK=PASS');
  console.log('R158_LIVE_AUTH_PRODUCTION_PAYMENTS_AND_DELIVERY=NO_GO');
  return{ok:true,revision:5,auditEvents:5,productionReady:false};
 }finally{await new Promise(ok=>server.close(ok));}
}
if(process.argv[1]&&process.argv[1].endsWith('/r158/e2e.mjs')){
 await runR158EndToEnd();
}
