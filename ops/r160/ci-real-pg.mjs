/**
 * R160 real pg 8.23.1 + synthetic TLS PG17, JWT, auth.sessions, HTTP and logout.
 * Runs ONLY in authorized GitHub Actions, never against an external database.
 */
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createR160PgTransport} from './pg-driver.mjs';
import {createR160StagingService} from './staging-service.mjs';

const check=(cond,msg)=>{if(!cond)throw Error('R160 CI: '+msg);};
check(process.env.GITHUB_ACTIONS==='true'&&
 process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='postgres',
 'disposable CI environment required');
const actor='15900000-0000-4159-8159-000000000001';
const session='15900000-0000-4159-8159-000000000501';
const series='15900000-0000-4159-8159-000000000301';
const ref='abcdefghijklmnopqrst',issuer='https://'+ref+'.supabase.co/auth/v1';
const origin='https://staging.marcosa.example';
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk={...publicKey.export({format:'jwk'}),kid:'r160-ci',alg:'ES256',use:'sig'};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function token(claimOverrides={}){
 const n=Math.floor(Date.now()/1000),h=encode({typ:'JWT',alg:'ES256',kid:jwk.kid});
 const p=encode({iss:issuer,aud:'authenticated',role:'authenticated',
  sub:actor,session_id:session,iat:n-20,nbf:n-20,exp:n+300,...claimOverrides});
 const data=h+'.'+p;
 return data+'.'+sign('sha256',Buffer.from(data),
  {key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
const caPem=await readFile(process.env.R160_CA_FILE,'utf8');
const pgConfig={host:'127.0.0.1',expectedHost:'127.0.0.1',port:5432,database:'postgres',
 user:'marcosa_r160_ci',password:process.env.R160_DB_PASSWORD,caPem,
 maxConnections:3,connectionTimeoutMs:3000};
let transport,service;
try{
 transport=createR160PgTransport({config:pgConfig,ciLoopback:true});
 await transport.preflight();
 const client=await transport.connect();
 try{
  const t=await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
  check(t.rows.length===1&&t.rows[0].ssl===true,'actual PostgreSQL TLS required');
 }finally{client.release();}
 await transport.end();transport=null;
 service=createR160StagingService({
  pgConfig,ciLoopback:true,
  settings:{stage:'staging',projectRef:ref,allowedOrigins:[origin],maxPreflightAgeMs:60000},
  jwksFetch:async(url,opts)=>{
   check(url===issuer+'/.well-known/jwks.json'&&opts.redirect==='error','JWKS URL not pinned');
   return{ok:true,status:200,text:async()=>JSON.stringify({keys:[jwk]})};
  }
 });
 const addr=await service.listen({port:0});
 check(addr.status.ready===true,'writer/auth/JWKS staging preflight failed');
 const base='http://127.0.0.1:'+addr.port;
 async function edit(payload,{key=randomUUID(),bearer=token(),from=origin}={}){
  const response=await fetch(base+'/v1/series/'+series+'/edit',{
   method:'POST',headers:{Origin:from,Authorization:'Bearer '+bearer,
    'Content-Type':'application/json','X-Idempotency-Key':key},
   body:JSON.stringify(payload)});
  return{status:response.status,json:await response.json()};
 }
 const payload={revision:0,title:'R160 TLS Verified Creator',description:'Staging signed edit'};
 const idempotencyKey=randomUUID();
 const first=await edit(payload,{key:idempotencyKey});
 check(first.status===200&&first.json.result.revision===1,
  'real TLS HTTP->PG17 owner mutation failed');
 const replay=await edit(payload,{key:idempotencyKey});
 check(replay.status===200&&JSON.stringify(replay.json)===JSON.stringify(first.json),
  'idempotent retry changed result');
 check((await edit({...payload,title:'Key changed'},{key:idempotencyKey})).status===409,
  'conflicting idempotency key accepted');
 check((await edit(payload)).status===409,'stale revision accepted');
 check((await edit({...payload,revision:1},{bearer:token({role:'service_role'})})).status===401,
  'service role spoofing accepted');
 check((await edit({...payload,revision:1},{from:'https://attacker.invalid'})).status===403,
  'unknown Origin accepted');
 const h=await fetch(base+'/health',{headers:{Origin:origin}});
 check(h.status===200&&(await h.json()).productionReady===false,'health claimed production readiness');
 check(process.env.R160_FIXTURE_ADMIN_REVOKE==='ready-to-revoke',
  'CI-only admin revocation not permitted');
 const revoke=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1','-c',
  "DELETE FROM auth.sessions WHERE id='"+session+"'"],{
   encoding:'utf8',timeout:6000,
   env:{PATH:process.env.PATH,PGHOST:'127.0.0.1',PGDATABASE:'postgres',
    PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:process.env.R160_ADMIN_PASSWORD}
  });
 check(revoke.status===0,'CI-only test logout failed');
 check((await edit({revision:1,title:'Blocked after logout',description:''})).status===401,
  'revoked session still permitted HTTP writes');
 console.log('R160_REAL_NODE_PG_TLS_SESSION_JWT_HTTP=PASS');
 console.log('R160_IDEMPOTENCY_ORIGIN_CONFLICT_AND_SIGNOUT=PASS');
 console.log('R160_LIVE_SUPABASE_AND_PRODUCTION=NO_GO');
}finally{
 if(service)await service.stop();
 if(transport)await transport.end();
}
