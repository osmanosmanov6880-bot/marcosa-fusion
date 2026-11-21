/**
 * R164 fail-closed emergency shutdown coordinator.
 * Immediately revokes the mutation gate before any asynchronous close.
 * A timeout is an UNKNOWN shutdown, NEVER proof the socket is closed.
 */
const REASONS=new Set(['dependency_lost','tls_mismatch','canary_degraded',
 'unapproved_change','restore_failed']);
const fail=m=>{throw Error('R164 rollback: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function createR164EmergencyRollback({
 runtime,lifecycle,ledger,clock=()=>Date.now(),timeoutMs=5000
}={}){
 ok(runtime&&typeof runtime.revokeReady==='function'&&
  typeof runtime.status==='function'&&lifecycle&&
  typeof lifecycle.stop==='function'&&typeof lifecycle.status==='function'&&
  ledger&&typeof ledger.append==='function'&&
  typeof clock==='function'&&Number.isInteger(timeoutMs)&&
  timeoutMs>=20&&timeoutMs<=30000,
  'trusted runtime, lifecycle, incident ledger and bounded timeout required');
 let phase='armed',nonce=null,action=null,lastAt=0;
 const counters={quarantines:0,verifiedCloses:0,unverifiedCloses:0};
 const status=()=>Object.freeze({phase,
  mutationReady:phase==='armed'&&runtime.status().ready===true,
  shutdownVerified:phase==='stopped',shutdownUnverified:phase==='unverified',
  replayFencePersistent:false,productionAuthorized:false,...counters});
 const trigger=({reason,incidentNonce}={})=>{
  ok(REASONS.has(reason)&&typeof incidentNonce==='string'&&
   /^[a-f0-9]{32}$/.test(incidentNonce),
   'fixed incident type and nonce required');
  if(action){
   ok(incidentNonce===nonce,'one incident action at a time');
   return action;
  }
  ok(phase==='armed','coordinator cannot re-arm without a new process');
  nonce=incidentNonce;phase='quarantined';counters.quarantines++;
  // Synchronous revoke is deliberately BEFORE any I/O or incident logging.
  runtime.revokeReady();
  lastAt=clock();
  try{ledger.append({event:'staging_rollback',phase:'shutdown',result:'blocked'});}
  catch{} // A broken in-memory log must never override shutdown.
  action=(async()=>{
   let timer;
   try{
    const result=await Promise.race([
     Promise.resolve().then(()=>lifecycle.stop()).then(()=>({closed:true}),
      ()=>({closed:false})),
     new Promise(resolve=>{timer=setTimeout(()=>resolve({closed:false}),timeoutMs);})
    ]);
    const realStop=lifecycle.status();
    if(result.closed===true&&
     (realStop.state==='stopped'||realStop.state==='failed')){
     phase='stopped';counters.verifiedCloses++;
    }else{
     phase='unverified';counters.unverifiedCloses++;
    }
   }catch{
    phase='unverified';counters.unverifiedCloses++;
   }finally{if(timer)clearTimeout(timer);}
   try{ledger.append({event:'staging_drain',phase:'shutdown',
    result:phase==='stopped'?'ok':'deny'});}catch{}
   return status();
  })();
  return action;
 };
 return Object.freeze({trigger,status});
}
