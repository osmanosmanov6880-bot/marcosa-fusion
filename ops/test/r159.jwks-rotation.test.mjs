import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createRotatingSupabaseVerifier} from '../r159/jwks-rotation.mjs';

const ref='abcdefghijklmnopqrst',issuer='https://'+ref+'.supabase.co/auth/v1';
const actor='15900000-0000-4159-8159-000000000001';
const session='15900000-0000-4159-8159-000000000002';
const start=1800000000000;
function makeKey(kid){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 return{privateKey,jwk:{...publicKey.export({format:'jwk'}),kid,alg:'ES256',use:'sig'}};
}
function token(key,kid,nowSec=Math.floor(start/1000)){
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const header=encode({alg:'ES256',kid,typ:'JWT'});
 const claims=encode({iss:issuer,aud:'authenticated',role:'authenticated',sub:actor,session_id:session,
  iat:nowSec-20,nbf:nowSec-20,exp:nowSec+200});
 const signed=header+'.'+claims;
 return signed+'.'+sign('sha256',Buffer.from(signed),
  {key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
test('R159 pinned JWKS cache, singleflight and actual key rollover',async()=>{
 let current=start,calls=0,active=true;
 const keyA=makeKey('alpha'),keyB=makeKey('beta');
 let keys=[keyA.jwk];
 const fetchImpl=async(url,options)=>{
  calls++;
  assert.equal(url,issuer+'/.well-known/jwks.json');
  assert.equal(options.redirect,'error');
  assert.equal(options.method,'GET');
  return{ok:true,status:200,text:async()=>JSON.stringify({keys})};
 };
 const verifier=createRotatingSupabaseVerifier({projectRef:ref,fetchImpl,
  clock:()=>current,cacheMs:30000,isSessionActive:async()=>active});
 const first=await Promise.all(Array.from({length:10},()=>verifier.verifyBearer(token(keyA,'alpha'))));
 assert.equal(first.length,10);assert.equal(calls,1);
 keys=[keyB.jwk];current+=31000;
 assert.equal((await verifier.verifyBearer(token(keyB,'beta',Math.floor(current/1000)))).actorId,actor);
 assert.equal(calls,2);
 await assert.rejects(verifier.verifyBearer(token(keyA,'alpha',Math.floor(current/1000))),/Invalid bearer/);
 active=false;
 await assert.rejects(verifier.verifyBearer(token(keyB,'beta',Math.floor(current/1000))),/Invalid bearer/);
 assert.equal(verifier.getPublicStatus().cacheFresh,true);
});
test('R159 expired JWKS never falls back to an obsolete key on outages',async()=>{
 let current=start,fail=false,calls=0;
 const key=makeKey('old');
 const fetchImpl=async()=>{
  calls++;if(fail)throw Error('service offline');
  return{ok:true,status:200,text:async()=>JSON.stringify({keys:[key.jwk]})};
 };
 const verifier=createRotatingSupabaseVerifier({projectRef:ref,fetchImpl,
  clock:()=>current,cacheMs:30000,isSessionActive:async()=>true});
 await verifier.verifyBearer(token(key,'old'));
 fail=true;current+=31000;
 await assert.rejects(verifier.verifyBearer(token(key,'old',Math.floor(current/1000))),/Invalid bearer/);
 assert.equal(verifier.getPublicStatus().keysCached,false);
 assert.equal(calls,2);
});
test('R159 invalid project, private JWK and redirects are refused',async()=>{
 assert.throws(()=>createRotatingSupabaseVerifier({projectRef:'https://attacker.example',
  isSessionActive:async()=>true}),/pinned Supabase/);
 const key=makeKey('private');
 const verifier=createRotatingSupabaseVerifier({projectRef:ref,
  fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({keys:[
   {...key.jwk,d:'secret'}]})}),isSessionActive:async()=>true});
 await assert.rejects(verifier.verifyBearer(token(key,'private')),/Invalid bearer/);
 const redirected=createRotatingSupabaseVerifier({projectRef:ref,
  fetchImpl:async()=>({ok:false,status:302,text:async()=>''}),
  isSessionActive:async()=>true});
 await assert.rejects(redirected.verifyBearer(token(key,'private')),/Invalid bearer/);
});
