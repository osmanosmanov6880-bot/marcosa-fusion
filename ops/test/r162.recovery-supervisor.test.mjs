import test from 'node:test';
import assert from 'node:assert/strict';
import {createR162RecoverySupervisor} from '../r162/recovery-supervisor.mjs';
function fixture(){
 let now=100000,fail=false,invalidations=0,ready=false,calls=0;
 const runtime={
  async preflight(){calls++;ready=false;
   if(fail)throw Error('Real PG unavailable');
   ready=true;return{ready:true};
  },
  revokeReady(){ready=false;invalidations++;return{ready:false};},
  status(){return{ready,productionReady:false};}
 };
 return{
  runtime,clock:()=>now,setTime:v=>{now=v;},advance:ms=>{now+=ms;},
  fail:v=>{fail=v;},counts:()=>({calls,invalidations,ready})
 };
}
test('R162 recovered preflight arms health, failure immediately revokes writes',async()=>{
 const f=fixture(),s=createR162RecoverySupervisor({runtime:f.runtime,clock:f.clock,
  baseBackoffMs:500,maxBackoffMs:4000,healthyIntervalMs:1000});
 assert.equal(s.status().ready,false);
 assert.equal((await s.poll()).ready,true);
 assert.equal(f.counts().calls,1);
 f.fail(true);f.advance(1000);
 const denied=await s.poll();
 assert.equal(denied.ready,false);
 assert.equal(denied.mode,'open');
 assert.equal(denied.denials,1);
 assert.equal(f.counts().invalidations,1);
 assert.equal((await s.poll()).skipped,1);
 f.fail(false);f.advance(500);
 assert.equal((await s.poll()).ready,true);
 assert.equal(s.status().failures,0);
 assert.equal(s.disable().ready,false);
 const before=f.counts().calls;
 await s.poll();assert.equal(f.counts().calls,before);
});
test('R162 exponential backoff caps, and duplicate polls coalesce',async()=>{
 const f=fixture(),s=createR162RecoverySupervisor({runtime:f.runtime,clock:f.clock,
  baseBackoffMs:500,maxBackoffMs:2000});
 f.fail(true);
 for(const delay of [500,1000,2000,2000,2000]){
  const result=await s.poll();
  assert.equal(result.ready,false);
  assert.equal(result.nextProbeAtMs-f.clock(),delay);
  f.advance(delay);
 }
 assert.equal(s.status().denials,5);
 f.fail(false);
 const results=await Promise.all([s.poll(),s.poll(),s.poll()]);
 assert.ok(results.every(x=>x.ready));
 assert.equal(f.counts().calls,6);
});
test('R162 malformed unsafe runtime or unbounded backoff rejected',()=>{
 assert.throws(()=>createR162RecoverySupervisor({runtime:{}}),/trusted runtime/);
 assert.throws(()=>createR162RecoverySupervisor({runtime:fixture().runtime,
  maxBackoffMs:Infinity}),/bounded recovery/);
});
