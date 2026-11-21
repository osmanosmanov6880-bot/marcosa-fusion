/**
 * R185 simulated canary + stop/rollback state machine, never a deployment.
 *
 * Actual traffic routing, user data, credential reads, writes to production
 * and changes to quarantine are impossible: no network or process executor.
 * A reproducible SHA256 transition chain helps later independent QA.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R185 pilot rehearsal: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=s=>createHash('sha256').update(s).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const phases=Object.freeze(['SHADOW','CANARY_1','CANARY_5','CANARY_10']);
const INJECT=new Set(['NONE','ERROR_SPIKE','LATENCY_SPIKE',
 'MANUAL_STOP','STALE_SOURCE']);
export const R185_REHEARSAL_PHASES=phases;
export function createR185PilotRehearsal({clock=()=>Date.now(),
 allowSynthetic=false}={}){
 ok(typeof clock==='function','clock required');
 function run({commit,bundleSha256,runId,intakeProof,
  windows,injection='NONE',maxErrorBps=200,maxP95Ms=450}={}){
  ok(allowSynthetic===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&
   Number.isSafeInteger(runId)&&runId>=10000&&
   intakeProof?.sourceCommit===commit&&
   intakeProof.sourceBundleSha256===bundleSha256&&
   intakeProof.runId===runId&&
   intakeProof.decision==='NO_GO_ACTIONABLE_STAGING_REQUIREMENTS'&&
   intakeProof.realPilotAuthorized===false&&
   intakeProof.productionAuthorized===false,
   'synthetic rehearsal requires pinned NO-GO intake');
  const{evidenceSha256:priorSha,...prior}=intakeProof;
  ok(H64.test(priorSha||'')&&
   sha(JSON.stringify(prior))===priorSha&&
   Array.isArray(windows)&&windows.length===phases.length&&
   INJECT.has(injection)&&
   Number.isSafeInteger(maxErrorBps)&&maxErrorBps>=0&&maxErrorBps<=500&&
   Number.isSafeInteger(maxP95Ms)&&maxP95Ms>=100&&maxP95Ms<=2500,
   'source evidence digest, four windows or bounded SLOs invalid');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>=intakeProof.observedAtMs&&
   now<=intakeProof.expiresAtMs,
   'stale or forged intake cannot lead to a rehearsal');
  const list=[],seen=new Set();
  for(let i=0;i<windows.length;i++){
   const w=windows[i];
   ok(w&&Object.getPrototypeOf(w)===Object.prototype&&
    Object.keys(w).sort().join(',')==='errors,p95Ms,phase,requests'&&
    w.phase===phases[i]&&!seen.has(w.phase)&&
    Number.isSafeInteger(w.requests)&&w.requests>=100&&w.requests<=10000&&
    Number.isSafeInteger(w.errors)&&w.errors>=0&&w.errors<=w.requests&&
    Number.isSafeInteger(w.p95Ms)&&w.p95Ms>=1&&w.p95Ms<=60000,
    'ordered synthetic window telemetry must be exact and bounded');
   seen.add(w.phase);
   list.push({...w});
  }
  const transitions=[];
  let previous=sha('R185_SHADOW_ONLY:'+commit+':'+runId+':'+priorSha);
  function transition(phase,state,reason,metric){
   const row={sequence:transitions.length+1,phase,state,reason,
    errorBps:metric?.errorBps??0,p95Ms:metric?.p95Ms??0,
    previousSha256:previous};
   const hash=sha(JSON.stringify(row));
   transitions.push({...row,eventSha256:hash});
   previous=hash;
  }
  transition('PREFLIGHT','CLOSED','NO_REAL_DEPLOY',null);
  let failure=null;
  for(let i=0;i<list.length;i++){
   const w=list[i],bps=Math.ceil(w.errors*10000/w.requests);
   let reason=null;
   if(injection==='MANUAL_STOP'&&i===1)reason='MANUAL_STOP';
   else if(injection==='STALE_SOURCE'&&i===1)reason='SOURCE_CHANGED';
   else if(injection==='ERROR_SPIKE'&&i===1)reason='INJECTED_ERROR_SPIKE';
   else if(injection==='LATENCY_SPIKE'&&i===1)reason='INJECTED_LATENCY_SPIKE';
   else if(bps>maxErrorBps)reason='ERROR_BUDGET_EXCEEDED';
   else if(w.p95Ms>maxP95Ms)reason='P95_EXCEEDED';
   transition(w.phase,reason?'ABORTED':'SHADOW_PASSED',
    reason||'WITHIN_SYNTHETIC_SLO',
    {errorBps:bps,p95Ms:w.p95Ms});
   if(reason){failure=reason;break;}
  }
  // Both success and failure MUST exercise a hypothetical stop and rollback.
  transition('STOP','CLOSED',failure||'REHEARSAL_END',null);
  transition('ROLLBACK','VERIFIED','SIMULATED_RESTORE_ONLY',null);
  const evidence={
   schemaVersion:1,scope:'synthetic-staging-canary-rehearsal-only',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId,intakeEvidenceSha256:priorSha,injection,
   windowsAnalyzed:failure?transitions.length-1-2:phases.length,
   syntheticMaxErrorBps:maxErrorBps,syntheticMaxP95Ms:maxP95Ms,
   failureReason:failure||'NONE',
   stopped:true,simulatedRollbackVerified:true,
   quarantineRemainsClosed:true,actualTrafficRouted:false,
   actualDeploymentAttempted:false,realIncidentRecoveryProven:false,
   realPilotAuthorized:false,productionAuthorized:false,
   transitions,transitionChainSha256:previous,
   observedAtMs:now,
   decision:failure?'NO_GO_REHEARSAL_ABORTED':'NO_GO_REHEARSAL_COMPLETED'
  };
  return Object.freeze({...evidence,evidenceSha256:sha(JSON.stringify(evidence))});
 }
 return Object.freeze({run,publicStatus:()=>({
  enabled:allowSynthetic,syntheticOnly:true,productionAuthorized:false})});
}
