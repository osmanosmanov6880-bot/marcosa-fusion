/**
 * R160 staging-only assembly. Uses actual pg@8.23.1, R157 trust boundary,
 * Supabase auth.sessions and pinned rotating JWKS. Never auto-listens/deploys.
 * Only operator-supplied, verified server configuration may initialize it.
 */
import {createR160PgTransport} from './pg-driver.mjs';
import {createSupabaseSessionChecker} from '../r159/supabase-sessions.mjs';
import {createRotatingSupabaseVerifier} from '../r159/jwks-rotation.mjs';
import {CommandStoreError} from '../r157/pg-command-store.mjs';
import {createR161SessionFencedStore} from '../r161/session-fenced-store.mjs';
import {createCommandHttpServer,createRateLimiter} from '../r157/http-gateway.mjs';

const fail=m=>{throw Error('R160 staging: '+m);};
const requireOk=(b,m)=>{if(!b)fail(m);};
export function validateStagingSettings({projectRef,allowedOrigins,stage='staging',
 maxPreflightAgeMs=15000}={}){
 requireOk(stage==='staging','only staging tier accepted');
 requireOk(typeof projectRef==='string'&&/^[a-z0-9]{20,32}$/.test(projectRef),
  'pinned Supabase project required');
 requireOk(Array.isArray(allowedOrigins)&&allowedOrigins.length>=1&&allowedOrigins.length<=3&&
  new Set(allowedOrigins).size===allowedOrigins.length,'unique origins required');
 requireOk(allowedOrigins.every(o=>typeof o==='string'&&
   (/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(o)||
    (process.env.GITHUB_ACTIONS==='true'&&
    /^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(o)))),
  'verified HTTPS origins only (except isolated CI)');
 requireOk(Number.isInteger(maxPreflightAgeMs)&&maxPreflightAgeMs>=1000&&maxPreflightAgeMs<=60000,
  'bounded freshness required');
 return Object.freeze({projectRef,allowedOrigins:[...allowedOrigins],stage,maxPreflightAgeMs});
}
async function probeSessionReader(transport){
 let client,started=false;
 try{
  client=await transport.connect();
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')
   fail('unexpected database client');
  await client.query('BEGIN READ ONLY');started=true;
  await client.query("SET LOCAL statement_timeout='3000ms'");
  await client.query('SET LOCAL ROLE marcosa_r159_auth_reader');
  await client.query('SELECT id,user_id FROM auth.sessions LIMIT 0');
  await client.query('ROLLBACK');started=false;
  return true;
 }catch{
  if(client&&started)try{await client.query('ROLLBACK');}catch{}
  fail('Supabase session-reader role preflight failed');
 }finally{if(client)try{client.release();}catch{}}
}
/**
 * Transport injection is restricted to trusted process assembly (and CI).
 * Outside CI the only supported entrypoint is createR160StagingService().
 */
export function assembleR160Staging({transport,settings,jwksFetch,clock=()=>Date.now()}={}){
 requireOk(transport&&typeof transport.connect==='function'&&
  typeof transport.end==='function'&&typeof transport.preflight==='function'&&
  transport.settings?.tlsCertificateVerified===true,'verified PostgreSQL transport required');
 requireOk(typeof clock==='function','valid clock required');
 const safe=validateStagingSettings(settings);
 const checkSession=createSupabaseSessionChecker({pool:transport,clock});
 const verifier=createRotatingSupabaseVerifier({
  projectRef:safe.projectRef,isSessionActive:checkSession,fetchImpl:jwksFetch,
  clock,cacheMs:120000,maxLifetimeSeconds:3600
 });
 let readyAt=0,epoch=0,closing=false,stopped=false,pending=null,listening=false;
 const trustedStore=createR161SessionFencedStore({pool:transport,clock});
 const gate=Object.freeze({async execute(data){
  if(!status().ready)
   throw new CommandStoreError('Staging readiness proof missing or expired',503);
  return trustedStore.execute(data);
 }});
 const http=createCommandHttpServer({verifier,store:gate,allowedOrigins:safe.allowedOrigins,
  limiter:createRateLimiter({limit:30,windowMs:60000,maxEntries:500})});
 async function preflight(){
  if(stopped||closing)fail('stopped service cannot be armed');
  if(pending)return pending;
  const ticket=++epoch;
  pending=(async()=>{
   readyAt=0; // Revokes mutation gate before any dependency probe.
   await transport.preflight();
   await probeSessionReader(transport);
   await verifier.warmKeys();
   if(ticket!==epoch||closing||stopped)fail('preflight superseded by shutdown or revocation');
   readyAt=clock();
   return status();
  })().catch(()=>{readyAt=0;fail('preflight failed closed');}).finally(()=>{pending=null;});
  return pending;
 }
 function status(){
  const jwksFresh=verifier.getPublicStatus().cacheFresh;
  const live=!closing&&!stopped&&readyAt>0&&
   clock()-readyAt>=0&&clock()-readyAt<safe.maxPreflightAgeMs&&jwksFresh;
  return Object.freeze({tier:'staging',state:stopped?'stopped':closing?'draining':live?'ready':'locked',
   ready:live,productionReady:false,externalDeliveryEnabled:false,
   actualPaymentsEnabled:false,jwks:jwksFresh,
   sessionCheckMandatory:true});
 }
 async function listen({port=0,host='127.0.0.1'}={}){
  requireOk(!listening&&!stopped&&!closing,'cannot listen twice');
  requireOk(host==='127.0.0.1'&&Number.isInteger(port)&&port>=0&&port<=65535,
   'staging gateway listens only on explicit loopback');
  await preflight();
  await new Promise((resolve,reject)=>{
   http.once('error',reject);
   http.listen(port,host,()=>{http.removeListener('error',reject);resolve();});
  });
  listening=true;
  return Object.freeze({host,port:http.address().port,status:status()});
 }
 function revokeReady(){
  ++epoch;readyAt=0;
  return status();
 }
 async function stop(){
  if(stopped)return;
  closing=true;revokeReady();
  if(pending)try{await pending;}catch{}
  if(listening){
   await new Promise(resolve=>http.close(()=>resolve()));
   listening=false;
  }
  stopped=true;await transport.end();
 }
 return Object.freeze({preflight,listen,stop,revokeReady,status,server:http});
}
export function createR160StagingService({settings,pgConfig,clock,jwksFetch,ciLoopback=false}={}){
 const safe=validateStagingSettings(settings);
 // This is the only default factory: real pinned pg driver, strict CA and role.
 let emergencyRevoke=null;
 const transport=createR160PgTransport({config:pgConfig,clock,ciLoopback,
  onPoolError:()=>{if(emergencyRevoke)emergencyRevoke();}});
 const runtime=assembleR160Staging({transport,settings:safe,jwksFetch,clock});
 emergencyRevoke=runtime.revokeReady;
 return runtime;
}
