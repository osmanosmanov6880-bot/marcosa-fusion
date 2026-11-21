import test from 'node:test';
import assert from 'node:assert/strict';
import {createR162StagingLifecycle} from '../r162/lifecycle.mjs';

function scenario({failure=null}={}){
 const events=[];let ready=false;
 const runtime={
  status:()=>({ready,productionReady:false}),
  async listen(arg){events.push('command.listen');if(failure==='command')throw Error('db offline');
   assert.equal(arg.host,'127.0.0.1');ready=true;return{host:'127.0.0.1',port:31001};},
  async stop(){events.push('command.stop');ready=false;}
 };
 const control={
  async listen(arg){events.push('control.listen');if(failure==='control')throw Error('unauthorized');
   return{host:arg.host,port:31002};},
  async close(){events.push('control.close');}
 };
 const ingressFactory=async({upstreamPort})=>{
  events.push('ingress.factory');assert.equal(upstreamPort,31001);
  if(failure==='factory')throw Error('bad cert');
  return{
   async listen(arg){events.push('ingress.listen');if(failure==='ingress')throw Error('bind unavailable');
    return{host:failure==='external'?'0.0.0.0':arg.host,port:31003};},
   async close(){events.push('ingress.close');}
  };
 };
 return{events,lifecycle:createR162StagingLifecycle({runtime,control,ingressFactory})};
}
test('R162 atomic loopback startup and reverse-order graceful drain',async()=>{
 const {events,lifecycle}=scenario();
 assert.equal(lifecycle.status().state,'cold');
 const started=await lifecycle.start();
 assert.equal(started.https,31003);
 assert.equal(started.productionReady,false);
 assert.deepEqual(events.slice(0,4),[
  'command.listen','control.listen','ingress.factory','ingress.listen']);
 await lifecycle.stop();
 assert.equal(lifecycle.status().state,'stopped');
 assert.deepEqual(events.slice(4),['ingress.close','control.close','command.stop']);
 assert.equal(lifecycle.status().drains,1);
 await lifecycle.stop();assert.equal(lifecycle.status().drains,1);
 await assert.rejects(lifecycle.start(),/only start once/);
});
test('R162 every partial start rolls back even on invalid binding',async()=>{
 for(const failure of ['command','control','factory','ingress','external']){
  const {events,lifecycle}=scenario({failure});
  await assert.rejects(lifecycle.start(),/launch rejected/);
  assert.equal(lifecycle.status().state,'failed');
  assert.equal(lifecycle.status().rollbacks,1);
  assert.equal(events.at(-1),'command.stop');
  assert.ok(events.includes('control.close'));
  await assert.rejects(lifecycle.start(),/only start once/);
 }
});
test('R162 rejects unsafe assembly and missing TLS without exposing secret input',async()=>{
 assert.throws(()=>createR162StagingLifecycle({runtime:{},control:{}}),
  /trusted command runtime/);
 await assert.rejects(
  (await import('../r162/lifecycle.mjs')).assembleR162OperatorBoot({
   hostname:'staging.example.test',certPem:'wrong',keyPem:'secret'}),
  /invalid TLS X509/);
});
