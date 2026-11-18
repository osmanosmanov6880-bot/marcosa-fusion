/**
 * R161 CI-only full transport acceptance.
 * All identities, TLS signing keys, PostgreSQL users and webhooks are synthetic.
 */
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {request as tlsRequest} from 'node:https';
import {createR160PgTransport} from '../r160/pg-driver.mjs';
import {createR160StagingService} from '../r160/staging-service.mjs';
import {createR161TlsIngress} from './tls-ingress.mjs';
import {createR161SessionFencedStore} from './session-fenced-store.mjs';
import {createR161WebhookInbox,createR161WebhookInboxServer} from './webhook-inbox.mjs';
import {createR160SignedWebhookProvider} from '../r160/webhook-provider.mjs';

const check=(condition,message)=>{if(!condition)throw Error('R161 CI: '+message);};
check(process.env.GITHUB_ACTIONS==='true'&&
 process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='postgres',
 'disposable PostgreSQL 17 GitHub CI only');
const actor='15900000-0000-4159-8159-000000000001';
const sessionOne='16100000-0000-4161-8161-000000000501';
const sessionTwo='16100000-0000-4161-8161-000000000502';
const episode='15900000-0000-4159-8159-000000000401';
const recipient='15900000-0000-4159-8159-000000000002';
const series='15900000-0000-4159-8159-000000000301';
const projectRef='abcdefghijklmnopqrst',host='staging.marcosa.example';
const origin='https://'+host,issuer='https://'+projectRef+'.supabase.co/auth/v1';
const webhookSecret='r161-ci-only-fake-webhook-signing-secret-not-live';
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk={...publicKey.export({format:'jwk'}),kid:'r161-ci-ephemeral',alg:'ES256',use:'sig'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function bearer(session){
 const now=Math.floor(Date.now()/1000);
 const h=b64({alg:'ES256',kid:jwk.kid,typ:'JWT'});
 const p=b64({iss:issuer,aud:'authenticated',role:'authenticated',sub:actor,
  session_id:session,iat:now-20,nbf:now-20,exp:now+300});
 const data=h+'.'+p;
 return data+'.'+sign('sha256',Buffer.from(data),
  {key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
function adminSql(sql){
 check(process.env.R161_ADMIN_PASSWORD==='r160-disposable-admin-only',
  'signed synthetic database admin identity required');
 const r=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{
  encoding:'utf8',timeout:8000,env:{
   PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',
   PGDATABASE:'postgres',PGUSER:'postgres',PGPASSWORD:process.env.R161_ADMIN_PASSWORD
  }});
 check(r.status===0,'synthetic fixture SQL failed');
 return (r.stdout||'').trim();
}
async function tlsCall(port,caPem,session,payload,{originHeader=origin,hostHeader=host}={}){
 const body=JSON.stringify(payload),idempotencyKey=randomUUID();
 return new Promise((resolve,reject)=>{
  const req=tlsRequest({
   hostname:'127.0.0.1',servername:host,port,
   method:'POST',path:'/v1/series/'+series+'/edit',ca:caPem,rejectUnauthorized:true,
   headers:{Host:hostHeader,Origin:originHeader,'Content-Type':'application/json',
    'Content-Length':Buffer.byteLength(body),'X-Idempotency-Key':idempotencyKey,
    Authorization:'Bearer '+bearer(session)}
  },res=>{
   let answer='';res.on('data',bytes=>answer+=bytes);
   res.on('end',()=>resolve({status:res.statusCode,response:JSON.parse(answer)}));
  });
  req.on('error',reject);req.end(body);
 });
}
const root=await mkdtemp(join(tmpdir(),'r161-e2e-'));
let ownerPool=null,service=null,ingress=null,receiverPool=null,receiver=null;
try{
 const caPem=await readFile(process.env.R160_CA_FILE,'utf8');
 const pgConfig={host:'127.0.0.1',expectedHost:'127.0.0.1',port:5432,
  database:'postgres',user:'marcosa_r160_ci',
  password:process.env.R160_DB_PASSWORD,caPem,maxConnections:3};
 adminSql("INSERT INTO auth.sessions(id,user_id) VALUES ('"+sessionOne+"','"+actor+"'),('"+
  sessionTwo+"','"+actor+"');");
 ownerPool=createR160PgTransport({config:pgConfig,ciLoopback:true});
 service=createR160StagingService({
  pgConfig,ciLoopback:true,settings:{projectRef,stage:'staging',
   allowedOrigins:[origin],maxPreflightAgeMs:60000},
  jwksFetch:async(url,opts)=>{
   check(url===issuer+'/.well-known/jwks.json'&&opts.redirect==='error',
    'signing key endpoint not pinned');
   return{ok:true,status:200,text:async()=>JSON.stringify({keys:[jwk]})};
  }
 });
 const staging=await service.listen({port:0});
 check(staging.status.ready,'staging writer/Auth/JWKS preflight failed');
 const keyFile=join(root,'tls-key.pem'),certFile=join(root,'tls-cert.pem');
 const issue=spawnSync('openssl',[
  'req','-x509','-newkey','rsa:2048','-nodes',
  '-keyout',keyFile,'-out',certFile,'-days','2','-subj','/CN='+host,
  '-addext','subjectAltName=DNS:'+host
 ],{encoding:'utf8',timeout:12000});
 check(issue.status===0,'temporary ingress certificate failed');
 const certPem=await readFile(certFile,'utf8');
 const keyPem=await readFile(keyFile,'utf8');
 ingress=createR161TlsIngress({hostname:host,certPem,keyPem,upstreamPort:staging.port});
 const ingressAddr=await ingress.listen();
 const first=await tlsCall(ingressAddr.port,certPem,sessionOne,
  {revision:1,title:'R161 TLS + Fenced Session',description:'Synthetic CI staging'});
 check(first.status===200&&first.response.result.revision===2,
  'real signed HTTPS->JWT->transaction session fence->PostgreSQL failed');
 const denyOrigin=await tlsCall(ingressAddr.port,certPem,sessionOne,
  {revision:2,title:'No',description:''},{originHeader:'https://attacker.example'});
 check(denyOrigin.status===403,'TLS ingress allowed untrusted Origin');
 const denyHost=await tlsCall(ingressAddr.port,certPem,sessionOne,
  {revision:2,title:'No',description:''},{hostHeader:'attacker.example'});
 check(denyHost.status===403,'TLS ingress allowed wrong Host');
 const directStore=createR161SessionFencedStore({
  pool:ownerPool,
  onAfterQuery:async()=>{adminSql("DELETE FROM auth.sessions WHERE id='"+sessionTwo+"';");}
 });
 let blocked=false;
 try{
  await directStore.execute({actorId:actor,sessionId:sessionTwo,
   authExpiresAt:Math.floor(Date.now()/1000)+300,
   name:'edit',key:randomUUID(),data:{seriesId:series,revision:2,
    title:'R161 Revoked Before Commit',description:'Must never commit'}});
 }catch(e){blocked=e.status===401;}
 check(blocked,'session deleted between SQL mutation and COMMIT was not rejected');
 const db=await ownerPool.connect();
 try{
  const row=await db.query('SELECT title,revision FROM public.marcosa_seasons WHERE id=$1::uuid',[series]);
  check(row.rows[0]?.revision==='2'||row.rows[0]?.revision===2,
   'rolled-back transaction changed season revision');
  check(row.rows[0]?.title==='R161 TLS + Fenced Session',
   'rolled-back transaction persisted an unauthorized title');
 }finally{db.release();}
 receiverPool=createR160PgTransport({config:{...pgConfig,user:'marcosa_r161_ci',
  password:process.env.R161_INBOX_PASSWORD},ciLoopback:true});
 const inbox=createR161WebhookInbox({pool:receiverPool,signatureSecret:webhookSecret});
 receiver=createR161WebhookInboxServer({inbox});
 const local=await receiver.listen({port:0});
 const dedupe='marcosa-r159-'+createHash('sha256').update(episode+':'+recipient).digest('hex');
 const provider=createR160SignedWebhookProvider({
  endpoint:'https://notify.staging.example/v1/notifications/deliver',
  expectedHost:'notify.staging.example',caPem:certPem,
  signatureSecret:webhookSecret,allowNetwork:true,
  // Injected local HTTP transport: no external network or provider.
  sendWire:async(_url,options,body)=>{
   const res=await fetch('http://127.0.0.1:'+local.port+'/v1/notifications/deliver',{
    method:'POST',headers:options.headers,body});
   return{status:res.status,headers:Object.fromEntries(res.headers)};
  }
 });
 for(let i=0;i<2;i++){
  const result=await provider.send({
   episodeId:episode,recipientId:recipient,idempotencyKey:dedupe,
   consentFenceConfirmedAtMs:Date.now(),deliveryFence:async()=>true
  });
  check(result.accepted===true,'signed inbox did not return durable acknowledgement');
 }
 check(adminSql("SELECT accepted_count FROM marcosa_private.r161_webhook_inbox WHERE "+
  "delivery_key='"+dedupe+"';")==='2','duplicate webhook created extra entry');
 console.log('R161_PINNED_HTTPS_INGRESS_REAL_PG17=PASS');
 console.log('R161_SESSION_REVOKED_DURING_SQL_ROLLED_BACK=PASS');
 console.log('R161_HMAC_WEBHOOK_PG17_DURABLE_DEDUPE=PASS');
 console.log('R161_REAL_SUPABASE_AND_PUBLIC_DELIVERY=NO_GO');
}finally{
 if(receiver)await receiver.stop();
 if(receiverPool)await receiverPool.end();
 if(ingress)await ingress.close();
 if(service)await service.stop();
 if(ownerPool)await ownerPool.end();
 await rm(root,{recursive:true,force:true});
}
