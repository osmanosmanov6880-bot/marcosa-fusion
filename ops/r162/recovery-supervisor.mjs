/**
 * R162 explicit dependency recovery supervisor, designed to be driven by an
 * operator-managed scheduler. NO timers/network/jobs run on module import.
 * Any failed DB/Auth/JWKS preflight revokes write readiness immediately.
 */
const requireOk=(ok,m)=>{if(!ok)throw Error('R162 recovery: '+m);};
export function createR162RecoverySupervisor({
 runtime,clock=()=>Date.now(),baseBackoffMs=1000,maxBackoffMs=30000,
 healthyIntervalMs=10000
}={}){
 requireOk(runtime&&typeof runtime.preflight==='function'&&
  typeof runtime.revokeReady==='function'&&typeof runtime.status==='function',
  'trusted runtime with explicit fail-closed revocation required');
 requireOk(typeof clock==='function','clock required');
 for(const [v,min,max] of [[baseBackoffMs,200,10000],
  [maxBackoffMs,baseBackoffMs,120000],
  [healthyIntervalMs,1000,60000]])
  requireOk(Number.isInteger(v)&&v>=min&&v<=max,'bounded recovery windows required');
 let mode='disarmed',inflight=null,stopped=false,nextAllowed=0,failures=0;
 const stats={attempts:0,successes:0,denials:0,skipped:0};
 const status=()=>Object.freeze({mode,ready:!stopped&&mode==='healthy'&&
  runtime.status().ready===true,stagingOnly:true,productionReady:false,
  nextProbeAtMs:nextAllowed,failures,...stats});
 async function poll(){
  if(stopped)return status();
  if(inflight)return inflight;
  const now=clock();
  if(now<nextAllowed){stats.skipped++;return status();}
  stats.attempts++;mode='checking';
  inflight=(async()=>{
   try{
    const proof=await runtime.preflight();
    if(stopped||proof?.ready!==true||runtime.status().ready!==true)
     throw Error('Readiness proof is unavailable');
    failures=0;mode='healthy';stats.successes++;
    nextAllowed=clock()+healthyIntervalMs;
   }catch{
    runtime.revokeReady();
    stats.denials++;failures++;
    mode='open';
    // Exponential with overflow bounds, no infinite retries or tight loops.
    const delay=Math.min(maxBackoffMs,baseBackoffMs*Math.pow(2,Math.min(failures-1,16)));
    nextAllowed=clock()+delay;
   }finally{inflight=null;}
   return status();
  })();
  return inflight;
 }
 function disable(){
  stopped=true;mode='stopped';nextAllowed=Number.MAX_SAFE_INTEGER;
  runtime.revokeReady();
  return status();
 }
 return Object.freeze({poll,disable,status});
}
