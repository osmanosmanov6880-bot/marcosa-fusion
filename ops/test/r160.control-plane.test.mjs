import test from 'node:test';
import assert from 'node:assert/strict';
import {createR160ControlPlane} from '../r160/control-plane.mjs';
const token='r160-staging-secret-operator-token-only-48chars';
function fake(){
 let state='locked',probes=0;
 return{
  get probes(){return probes;},
  status(){return{ready:state==='ready',state,productionReady:false};},
  async preflight(){probes++;state='ready';return this.status();},
  async stop(){state='stopped';}
 };
}
test('R160 control plane enforces localhost and admin authorization for mutations',async()=>{
 const runtime=fake(),ctrl=createR160ControlPlane({runtime,adminToken:token});
 const addr=await ctrl.listen({port:0});
 const url='http://127.0.0.1:'+addr.port;
 async function req(path,{method='GET',auth,origin}={}){
  const headers={...(auth?{Authorization:'Bearer '+auth}:{}),...(origin?{Origin:origin}:{})};
  const r=await fetch(url+path,{method,headers,body:method==='POST'?'':undefined});
  return{code:r.status,json:await r.json()};
 }
 try{
  assert.equal((await req('/live')).code,200);
  assert.equal((await req('/ready')).code,503);
  assert.equal((await req('/preflight',{method:'POST'})).code,401);
  assert.equal((await req('/preflight',{method:'POST',auth:token+'tamper'})).code,401);
  assert.equal((await req('/preflight',{method:'POST',auth:token,origin:'https://evil.test'})).code,400);
  assert.equal(runtime.probes,0);
  assert.equal((await req('/preflight',{method:'POST',auth:token})).code,200);
  assert.equal((await req('/ready')).code,200);
  assert.equal(runtime.probes,1);
  assert.equal((await req('/metrics',{auth:token})).json.deniedAdminRequests,2);
  assert.equal((await req('/drain',{method:'POST',auth:token})).code,200);
  assert.equal((await req('/ready')).code,503);
  assert.equal((await req('/metrics',{auth:token})).json.productionReady,false);
 }finally{await ctrl.close();}
});
test('R160 control plane rejects weak secrets, non-loopback binds and duplicate binds',async()=>{
 const runtime=fake();
 assert.throws(()=>createR160ControlPlane({runtime,adminToken:'short'}),/random admin token/);
 const ctrl=createR160ControlPlane({runtime,adminToken:token});
 await assert.rejects(ctrl.listen({host:'0.0.0.0',port:0}),/loopback-only/);
 await ctrl.listen({port:0});
 await assert.rejects(ctrl.listen({port:0}),/loopback-only/);
 await ctrl.close();
});
