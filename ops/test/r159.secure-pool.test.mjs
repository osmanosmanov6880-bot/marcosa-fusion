import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {createSecurePgPool,validatePgConfig,probeWriterPool} from '../r159/secure-pool.mjs';

// Validate against a pinned, real certificate from the fixture, not regex-only.
const pem=rootCertificates.find(value=>{try{const c=new X509Certificate(value);const now=Date.now();return Date.parse(c.validFrom)<=now&&Date.parse(c.validTo)>now;}catch{return false;}});
assert.ok(pem,'Node.js must ship a valid CA test certificate');
const base=()=>({host:'db.example.test',expectedHost:'db.example.test',port:5432,database:'marcosa',
 user:'marcosa_gateway',password:'test-only-strong-password-never-committed-real',caPem:pem,maxConnections:3});
test('R159 deny insecure connection overrides, fallback and privileged roles',()=>{
 for(const alteration of [
  {host:'attacker.test'},{expectedHost:'attacker.test'},
  {user:'postgres'},{user:'service_role'},{user:'authenticated'},
  {caPem:'not a PEM'},{port:0},{maxConnections:100},{password:'short'},
  {ssl:{rejectUnauthorized:false}},{connectionString:'postgresql://root@somewhere'},
  {connectionTimeoutMs:60000},{database:'marcosa;drop'}
 ])assert.throws(()=>validatePgConfig({...base(),...alteration}),/R159 secure PG/);
});
test('R159 vetted config sets verify-full TLS, capacity, timeouts and redacted settings',()=>{
 const x=validatePgConfig(base());
 assert.equal(x.ssl.rejectUnauthorized,true);
 assert.equal(x.ssl.servername,'db.example.test');
 assert.equal(x.ssl.minVersion,'TLSv1.2');
 assert.equal(x.max,3);
 const events=[];
 class Pool{
  constructor(opts){events.push(opts);}
  connect(){return Promise.resolve({release(){}});}
  end(){return Promise.resolve();}
 }
 const pool=createSecurePgPool({Pool,config:base()});
 assert.equal(events[0].ssl.rejectUnauthorized,true);
 assert.equal(pool.settings.tlsCertificateVerified,true);
 assert.doesNotMatch(JSON.stringify(pool.settings),/password|BEGIN CERTIFICATE/);
});
test('R159 writer role probe releases connections and rolls back failed role check',async()=>{
 let released=0,steps=[];
 const client={
  async query(sql){steps.push(sql);
   if(sql.includes('current_database'))return{rows:[{login:'marcosa_gateway',db:'marcosa',bypass:false}]};
   if(sql==='SELECT current_user AS role')return{rows:[{role:'marcosa_r156_writer'}]};
   return{rows:[]};
  },release(){released++;}
 };
 const pool={connect:async()=>client};
 assert.equal((await probeWriterPool(pool,{expectedLogin:'marcosa_gateway',expectedDatabase:'marcosa'})).ok,true);
 assert.deepEqual(steps.slice(-3),['SET LOCAL ROLE marcosa_r156_writer','SELECT current_user AS role','ROLLBACK']);
 assert.equal(released,1);
 await assert.rejects(probeWriterPool(pool,{expectedLogin:'wrong',expectedDatabase:'marcosa'}),/preflight failed/);
 assert.equal(released,2);
});
