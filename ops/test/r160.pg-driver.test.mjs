import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {R160_PG_VERSION,createR160PgTransport} from '../r160/pg-driver.mjs';
const ca=rootCertificates.find(s=>{try{const c=new X509Certificate(s),n=Date.now();
 return Date.parse(c.validFrom)<=n&&n<Date.parse(c.validTo);}catch{return false;}});
assert.ok(ca,'A real current CA certificate is required to test pinned TLS');
const settings=()=>({host:'db.staging.example',expectedHost:'db.staging.example',
 port:5432,database:'staging',user:'marcosa_gateway',password:'synthetic-only-test-password-must-never-be-live',
 caPem:ca,maxConnections:2,connectionTimeoutMs:1500});
test('R160 actual node-postgres version, TLS config, close and no secret in metadata',async()=>{
 assert.equal(R160_PG_VERSION,'8.23.1');
 const pool=createR160PgTransport({config:settings()});
 assert.equal(pool.settings.driverVersion,'8.23.1');
 assert.equal(pool.settings.tlsCertificateVerified,true);
 assert.equal(pool.settings.max,2);
 assert.equal(pool.settings.sessionRoleChangesAreTransactionLocal,true);
 assert.doesNotMatch(JSON.stringify(pool.settings),/synthetic-only-test-password|BEGIN CERTIFICATE/);
 await pool.end();
});
test('R160 cannot downgrade TLS, substitute host, or log in as postgres',()=>{
 for(const update of [
  {caPem:'not a certificate'},{host:'attacker.example'},
  {expectedHost:'not-a-match.example'},{user:'postgres'},
  {maxConnections:99},{connectionString:'postgres://somewhere'},
  {ssl:{rejectUnauthorized:false}}
 ]){
  assert.throws(()=>createR160PgTransport({config:{...settings(),...update}}),
   /R159 secure PG/);
 }
});
test('R160 refuses localhost outside isolated CI',()=>{
 assert.throws(()=>createR160PgTransport({config:{...settings(),
  host:'127.0.0.1',expectedHost:'127.0.0.1'}}),/loopback only/);
 assert.throws(()=>createR160PgTransport({config:settings(),ciLoopback:true}),
  /disposable CI/);
});
