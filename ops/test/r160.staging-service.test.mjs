import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {assembleR160Staging,validateStagingSettings} from '../r160/staging-service.mjs';
const projectRef='abcdefghijklmnopqrst';
const valid=()=>({stage:'staging',projectRef,allowedOrigins:['https://staging.example.test'],
 maxPreflightAgeMs:2000});
const jwk=(()=>{const {publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 return{...publicKey.export({format:'jwk'}),alg:'ES256',kid:'r160-key',use:'sig'};})();
function fixture({fail=null}={}){
 let closeCount=0,probeCount=0,queryLog=[],released=0;
 const transport={
  settings:{tlsCertificateVerified:true},
  async preflight(){probeCount++;if(fail==='writer')throw Error('No role');},
  async connect(){if(fail==='connect')throw Error('No database');return{
   async query(sql){queryLog.push(sql);if(fail==='reader'&&sql.includes('auth.sessions'))throw Error('Denied');
    return{rows:[]};},release(){released++;}
  };},async end(){closeCount++;}
 };
 return{transport,metrics:()=>({closeCount,probeCount,queryLog,released})};
}
const fetchImpl=async(url,options)=>{
 assert.equal(url,'https://'+projectRef+'.supabase.co/auth/v1/.well-known/jwks.json');
 assert.equal(options.redirect,'error');
 return{ok:true,status:200,text:async()=>JSON.stringify({keys:[jwk]})};
};
test('R160 staging preflight checks writer, auth reader, pinned JWKS before arming',async()=>{
 const f=fixture(),svc=assembleR160Staging({transport:f.transport,settings:valid(),jwksFetch:fetchImpl});
 try{
  assert.equal(svc.status().ready,false);
  const proof=await svc.preflight();
  assert.equal(proof.ready,true);
  assert.equal(proof.productionReady,false);
  assert.equal(proof.jwks,true);
  assert.deepEqual(f.metrics().queryLog.slice(0,5),[
   'BEGIN READ ONLY',"SET LOCAL statement_timeout='3000ms'",
   'SET LOCAL ROLE marcosa_r159_auth_reader','SELECT id,user_id FROM auth.sessions LIMIT 0','ROLLBACK'
  ]);
  assert.equal(f.metrics().released,1);
  assert.equal((await svc.listen({port:0})).status.ready,true);
  const url='http://127.0.0.1:'+svc.server.address().port+'/health';
  const ok=await fetch(url,{headers:{Origin:valid().allowedOrigins[0]}});
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).productionReady,false);
  assert.equal((await fetch(url,{headers:{Origin:'https://attacker.test'}})).status,403);
 }finally{await svc.stop();}
 assert.equal(svc.status().ready,false);
 assert.equal(f.metrics().closeCount,1);
});
test('R160 missing writer or auth read permission leaves gateway locked',async()=>{
 for(const fail of ['writer','reader','connect']){
  const f=fixture({fail}),svc=assembleR160Staging({
   transport:f.transport,settings:valid(),jwksFetch:fetchImpl});
  await assert.rejects(svc.preflight(),/preflight failed closed/);
  assert.equal(svc.status().ready,false);
  await svc.stop();
 }
});
test('R160 staging rejects production origins, duplicate host, untrusted transport',()=>{
 for(const bad of [
  {...valid(),stage:'production'},
  {...valid(),allowedOrigins:['http://attacker.test']},
  {...valid(),allowedOrigins:['https://good.test','https://good.test']},
  {...valid(),maxPreflightAgeMs:0}
 ])assert.throws(()=>validateStagingSettings(bad),/R160 staging/);
 assert.throws(()=>assembleR160Staging({transport:{settings:{tlsCertificateVerified:false}},
  settings:valid()}),/verified PostgreSQL/);
});
