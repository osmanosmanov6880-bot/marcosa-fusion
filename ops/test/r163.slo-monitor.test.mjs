import test from 'node:test';
import assert from 'node:assert/strict';
import {createR163SloMonitor} from '../r163/slo-monitor.mjs';
const good={statusCode:200,latencyMs:150,tlsPinned:true,readbackMatched:true};
test('R163 requires three independent complete healthy windows, no single-request greenwashing',()=>{
 let now=1800000000000;
 const m=createR163SloMonitor({clock:()=>now,windowSize:5,
  requiredHealthyWindows:3,observationTtlMs:5000});
 for(let batch=0;batch<3;batch++){
  for(let i=0;i<5;i++){now+=20;m.recordProbe(good);}
  assert.equal(m.status().ready,batch===2);
  assert.equal(m.status().evaluatedWindows,batch+1);
 }
 assert.equal(m.status().realUsersMeasured,false);
 assert.equal(m.status().productionAuthorized,false);
 now+=5001;
 assert.equal(m.status().ready,false,'old canary results must expire');
});
test('R163 any TLS, HTTP, body failure disarms instantly before window finishes',()=>{
 let now=200000;
 const m=createR163SloMonitor({clock:()=>now,windowSize:5,
  requiredHealthyWindows:2});
 for(let i=0;i<10;i++){now+=1;m.recordProbe(good);}
 assert.equal(m.status().ready,true);
 m.recordProbe({...good,tlsPinned:false});
 assert.equal(m.status().ready,false);
 assert.equal(m.status().healthyWindows,0);
 for(let i=0;i<4;i++){now+=1;m.recordProbe(good);}
 assert.equal(m.status().ready,false);
 for(let i=0;i<10;i++){now+=1;m.recordProbe(good);}
 assert.equal(m.status().ready,true);
 m.disable();
 assert.equal(m.status().ready,false);
 assert.throws(()=>m.recordProbe(good),/disarmed/);
});
test('R163 high p95, non-200 status, unsafe telemetry and backward clock denied',()=>{
 let now=500000;
 const m=createR163SloMonitor({clock:()=>now,windowSize:5,
  requiredHealthyWindows:2,maxP95LatencyMs:300});
 for(let i=0;i<5;i++){now+=1;m.recordProbe({...good,latencyMs:i===4?999:50});}
 assert.equal(m.status().lastP95LatencyMs,999);
 assert.equal(m.status().ready,false);
 for(let i=0;i<5;i++){now+=1;m.recordProbe({...good,statusCode:i===3?503:200});}
 assert.equal(m.status().lastErrorPercent,20);
 assert.equal(m.status().healthyWindows,0);
 assert.throws(()=>m.recordProbe({...good,ip:'192.0.2.1',statusCode:600}),/bounded non-PII/);
 now-=10;
 assert.throws(()=>m.recordProbe(good),/non-monotonic/);
});
