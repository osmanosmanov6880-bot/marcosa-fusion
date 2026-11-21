import test from 'node:test';
import assert from 'node:assert/strict';
import {createR164EmergencyRollback} from '../r164/emergency-rollback.mjs';
import {createR162StagingLifecycle} from '../r162/lifecycle.mjs';
import {createR162IncidentLedger} from '../r162/incident-ledger.mjs';
const NONCE='a'.repeat(32);
test('R164 mutation gate closes synchronously, then lifecycle stops and incident chain records event',async()=>{
 const events=[];let ready=true,closed=false;
 const runtime={revokeReady(){events.push('revoke');ready=false;},
  status(){return{ready};}};
 const lifecycle={async stop(){events.push('stop');closed=true;},
  status(){return{state:closed?'stopped':'ready'};}};
 const ledger=createR162IncidentLedger();
 const ctl=createR164EmergencyRollback({runtime,lifecycle,ledger});
 const promise=ctl.trigger({reason:'dependency_lost',incidentNonce:NONCE});
 assert.equal(ready,false);
 assert.equal(events[0],'revoke');
 const result=await promise;
 assert.equal(result.shutdownVerified,true);
 assert.deepEqual(events,['revoke','stop']);
 assert.equal(ledger.snapshot().entries.length,2);
 assert.equal((await ctl.trigger({reason:'dependency_lost',incidentNonce:NONCE})).shutdownVerified,true);
 assert.throws(()=>ctl.trigger({reason:'tls_mismatch',incidentNonce:'b'.repeat(32)}),
  /one incident/);
});
test('R164 shutdown timeout can never advertise a verified drain',async()=>{
 const runtime={revokeReady(){this.ready=false;},ready:true,status(){return{ready:this.ready};}};
 const lifecycle={stop(){return new Promise(()=>{});},status(){return{state:'draining'};}};
 const ctl=createR164EmergencyRollback({runtime,lifecycle,
  ledger:createR162IncidentLedger(),timeoutMs:20});
 const result=await ctl.trigger({reason:'restore_failed',incidentNonce:NONCE});
 assert.equal(result.shutdownVerified,false);
 assert.equal(result.shutdownUnverified,true);
 assert.equal(result.productionAuthorized,false);
 assert.equal(runtime.status().ready,false);
});
test('R164 concurrent late start cannot resurrect an already drained staging lifecycle',async()=>{
 const events=[];let resume;
 const pending=new Promise(resolve=>{resume=resolve;});
 const runtime={ready:false,
  async listen(){events.push('start-command');await pending;this.ready=true;
   return{host:'127.0.0.1',port:30001};},
  status(){return{ready:this.ready,productionReady:false};},
  async stop(){events.push('stop-command');this.ready=false;}
 };
 const control={async listen(){events.push('control-open');
  return{host:'127.0.0.1',port:30002};},
  async close(){events.push('control-close');}};
 const l=createR162StagingLifecycle({runtime,control,
  ingressFactory:async()=>({listen:async()=>({host:'127.0.0.1',port:30003}),
   close:async()=>events.push('ingress-close')})});
 const start=l.start();
 const stop=l.stop();
 resume();
 await assert.rejects(start,/launch rejected/);
 await stop;
 assert.equal(l.status().state,'stopped');
 assert.equal(l.status().rollbacks,1);
 assert.ok(!events.includes('control-open'));
 assert.equal(runtime.ready,false);
});
test('R164 rejects unbounded shutdown and unknown incident reason',()=>{
 const c=createR164EmergencyRollback({
  runtime:{revokeReady(){},status(){return{ready:false};}},
  lifecycle:{stop:async()=>{},status:()=>({state:'stopped'})},
  ledger:createR162IncidentLedger()});
 assert.throws(()=>c.trigger({reason:'deploy_prod',incidentNonce:NONCE}),
  /fixed incident/);
});
