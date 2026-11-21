/**
 * R162 genuine disposable PostgreSQL 17 chaos drill:
 * drop app login, terminate its idle sockets, fail closed, recover explicitly,
 * expire the JWT signing-key cache, and refuse a foreign PostgreSQL CA.
 * The database and certificates are synthetic GitHub Actions fixtures ONLY.
 */
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {rootCertificates} from 'node:tls';
import {X509Certificate,generateKeyPairSync} from 'node:crypto';
import {createR160StagingService} from '../r160/staging-service.mjs';
import {createR160PgTransport} from '../r160/pg-driver.mjs';
import {createR160ControlPlane} from '../r160/control-plane.mjs';
import {createR162RecoverySupervisor} from './recovery-supervisor.mjs';
import {createR162IncidentLedger} from './incident-ledger.mjs';

const assert=(ok,m)=>{if(!ok)throw Error('R162 CI chaos: '+m);};
assert(process.env.GITHUB_ACTIONS==='true'&&
 process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='postgres'&&
 process.env.R162_ADMIN_PASSWORD==='r160-disposable-admin-only',
 'only fixed disposable GitHub Actions PostgreSQL may be used');
function admin(sql){
 const p=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1','-c',sql],{
  encoding:'utf8',timeout:8000,env:{PATH:process.env.PATH,
   PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'postgres',
   PGUSER:'postgres',PGPASSWORD:process.env.R162_ADMIN_PASSWORD}
 });
 assert(p.status===0,'CI fixture administrator failed');
}
let now=Date.now();
const caPem=await readFile(process.env.R160_CA_FILE,'utf8');
const config={host:'127.0.0.1',expectedHost:'127.0.0.1',port:5432,
 database:'postgres',user:'marcosa_r160_ci',
 password:process.env.R160_DB_PASSWORD,caPem,maxConnections:3};
const projectRef='abcdefghijklmnopqrst';
const {publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk={...publicKey.export({format:'jwk'}),kid:'r162-rotation',alg:'ES256',use:'sig'};
let servedKeys=0;
const jwksFetch=async(url,opts)=>{
 assert(url==='https://'+projectRef+'.supabase.co/auth/v1/.well-known/jwks.json'&&
  opts.redirect==='error','JWKS unexpectedly redirected');
 servedKeys++;
 return{ok:true,status:200,text:async()=>JSON.stringify({keys:[jwk]})};
};
const runtime=createR160StagingService({pgConfig:config,ciLoopback:true,clock:()=>now,
 settings:{stage:'staging',projectRef,maxPreflightAgeMs:15000,
  allowedOrigins:['https://staging.marcosa.example']},jwksFetch});
const ledger=createR162IncidentLedger({clock:()=>now});
const control=createR160ControlPlane({runtime,
 adminToken:'r162-disposable-operator-only-ci-token-not-real'});
const sup=createR162RecoverySupervisor({runtime,clock:()=>now,
 baseBackoffMs:500,maxBackoffMs:4000,healthyIntervalMs:1000});
let roleRestored=false,controlLive=false;
try{
 const addr=await runtime.listen({host:'127.0.0.1',port:0});
 assert(addr.status.ready,'PG/JWKS preflight must be ready');
 const ctrl=await control.listen({host:'127.0.0.1',port:0});
 controlLive=true;
 const readyEndpoint='http://127.0.0.1:'+ctrl.port+'/ready';
 async function ready(){return(await fetch(readyEndpoint)).status;}
 assert(await ready()===200,'initial readiness must be 200');
 ledger.append({event:'staging_start',phase:'boot',result:'ok'});
 assert((await sup.poll()).ready===true,'initial supervisor preflight failed');
 // Disable new PostgreSQL logins AND terminate existing connections. No production data.
 admin("ALTER ROLE marcosa_r160_ci NOLOGIN; SELECT pg_terminate_backend(pid) "+
  "FROM pg_stat_activity WHERE usename='marcosa_r160_ci' AND pid<>pg_backend_pid();");
 now+=1000;
 const failed=await sup.poll();
 assert(failed.ready===false&&failed.mode==='open','PostgreSQL outage did not fail closed');
 assert(runtime.status().ready===false,'the old readiness proof survived a DB outage');
 assert(await ready()===503,'control plane advertised readiness during outage');
 ledger.append({event:'preflight_denied',phase:'recovery',result:'deny'});
 console.log('R162_DB_CONNECTION_TERMINATION_FAIL_CLOSED=PASS');
 admin('ALTER ROLE marcosa_r160_ci LOGIN;');
 roleRestored=true;
 now+=500;
 assert((await sup.poll()).ready===true,'PostgreSQL recovery preflight failed');
 assert(await ready()===200,'ready did not recover after TLS connection');
 ledger.append({event:'preflight_passed',phase:'recovery',result:'ok'});
 // Expire the key cache and the freshness proof without touching the DB.
 now+=130000;
 assert(runtime.status().ready===false,'expired JWKS accepted stale proof');
 assert(await ready()===503,'control plane served 200 with expired JWKS');
 ledger.append({event:'jwks_expired',phase:'runtime',result:'blocked'});
 assert((await sup.poll()).ready===true,'expired JWKS was not refreshed');
 assert(servedKeys>=2,'JWKS fetch was not retried on expiry');
 console.log('R162_JWKS_CACHE_EXPIRY_AND_REARM=PASS');
 const wrong=rootCertificates.find(value=>{
  try{const c=new X509Certificate(value);
   return Date.parse(c.validFrom)<=Date.now()&&Date.parse(c.validTo)>Date.now();}
  catch{return false;}
 });
 assert(typeof wrong==='string','valid unrelated test CA required');
 const falseTransport=createR160PgTransport({
  config:{...config,caPem:wrong},ciLoopback:true});
 let rejected=false;
 try{await falseTransport.preflight();}
 catch{rejected=true;}
 finally{await falseTransport.end();}
 assert(rejected,'untrusted CA unexpectedly completed PostgreSQL TLS handshake');
 console.log('R162_WRONG_POSTGRES_TLS_CA_REFUSED=PASS');
 ledger.append({event:'release_verified',phase:'verification',result:'ok'});
 const snapshot=ledger.snapshot();
 assert(ledger.verify(snapshot.head).consistent,'event hash chain integrity failed');
 assert(snapshot.entries.length===5,'expected five redacted operational events');
 console.log('R162_PRIVACY_SAFE_INCIDENT_CHAIN=PASS');
 console.log('R162_REAL_SUPABASE_PRODUCTION_DEPLOYMENT_PAYMENTS=NO_GO');
}finally{
 sup.disable();
 if(!roleRestored){
  try{admin('ALTER ROLE marcosa_r160_ci LOGIN;');}catch{}
 }
 if(controlLive)await control.close();
 await runtime.stop();
}
