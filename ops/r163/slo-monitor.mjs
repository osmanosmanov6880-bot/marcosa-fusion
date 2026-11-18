/**
 * R163 bounded, no-PII canary SLO window. Operator-driven, not a scheduler.
 * Uses non-overlapping batches to avoid repeatedly counting a single green
 * request; a failure immediately disarms the gate between windows.
 */
const fail=m=>{throw Error('R163 SLO: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function createR163SloMonitor({
 clock=()=>Date.now(),windowSize=20,requiredHealthyWindows=3,
 maxErrorPercent=5,maxP95LatencyMs=900,observationTtlMs=60000
}={}){
 ok(typeof clock==='function','clock required');
 ok(Number.isInteger(windowSize)&&windowSize>=5&&windowSize<=200&&
  Number.isInteger(requiredHealthyWindows)&&requiredHealthyWindows>=2&&
  requiredHealthyWindows<=10,'bounded independent windows required');
 ok(Number.isFinite(maxErrorPercent)&&maxErrorPercent>=0&&maxErrorPercent<=10&&
  Number.isInteger(maxP95LatencyMs)&&maxP95LatencyMs>=50&&
  maxP95LatencyMs<=10000&&Number.isInteger(observationTtlMs)&&
  observationTtlMs>=1000&&observationTtlMs<=300000,
  'bounded health thresholds required');
 let batch=[],healthyWindows=0,completed=0,stopped=false,lastAt=null,lastEvalAt=null;
 let lastSummary=null,failureSinceLastEvaluation=false;
 const summary=()=>Object.freeze({
  windowSize,requiredHealthyWindows,healthyWindows,
  evaluatedWindows:completed,
  lastP95LatencyMs:lastSummary?.p95??null,
  lastErrorPercent:lastSummary?.errorPercent??null,
  lastSampleAtMs:lastAt,
  lastEvaluatedAtMs:lastEvalAt,
  ready:!stopped&&healthyWindows>=requiredHealthyWindows&&
   lastAt!==null&&lastEvalAt!==null&&!failureSinceLastEvaluation&&
   clock()>=lastAt&&clock()-lastAt<=observationTtlMs&&
   clock()-lastEvalAt<=observationTtlMs,
  productionAuthorized:false,realUsersMeasured:false
 });
 function recordProbe({statusCode,latencyMs,tlsPinned,readbackMatched}={}){
  if(stopped)fail('monitor disarmed');
  ok(Number.isInteger(statusCode)&&statusCode>=100&&statusCode<=599&&
   Number.isFinite(latencyMs)&&latencyMs>=0&&latencyMs<=60000&&
   typeof tlsPinned==='boolean'&&typeof readbackMatched==='boolean',
   'only bounded non-PII telemetry accepted');
  const at=clock();
  ok(Number.isSafeInteger(at)&&at>=0&&(lastAt===null||at>=lastAt),
   'non-monotonic sample clock');
  lastAt=at;
  const success=statusCode===200&&tlsPinned&&readbackMatched;
  if(!success){
   healthyWindows=0;failureSinceLastEvaluation=true;
  }
  batch.push({success,latencyMs});
  if(batch.length===windowSize){
   completed++;
   const errors=batch.reduce((n,x)=>n+(!x.success?1:0),0);
   const sorted=batch.map(x=>x.latencyMs).sort((a,b)=>a-b);
   const p95=sorted[Math.ceil(0.95*sorted.length)-1];
   const errorPercent=errors*100/windowSize;
   const green=errors===0&&errorPercent<=maxErrorPercent&&
    p95<=maxP95LatencyMs;
   healthyWindows=green?healthyWindows+1:0;
   lastSummary=Object.freeze({p95,errorPercent,green});
   lastEvalAt=at;failureSinceLastEvaluation=!green;batch=[];
  }
  return summary();
 }
 function disable(){stopped=true;healthyWindows=0;return summary();}
 return Object.freeze({recordProbe,status:summary,disable});
}
