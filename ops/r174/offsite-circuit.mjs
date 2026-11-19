/**
 * R174 fail-closed offsite incident controller: explicit transition graph,
 * no automatic retry/recovery, tamper-evident hash chained PII-free receipts.
 * Designed for a single isolated CI process. Production requires durable
 * PostgreSQL append-only writes, independent operators and pager delivery.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const EVENTS=new Set([
 'ESCROW_UNAVAILABLE','ESCROW_SIGNATURE_INVALID',
 'DESTINATION_KMS_DENIED','DESTINATION_KMS_POLICY_DRIFT',
 'ARCHIVE_ROLLBACK','OBJECT_LOCK_DOWNGRADED',
 'CIPHERTEXT_MISMATCH','SOURCE_DEPENDENCY_REAPPEARED',
 'PG_RESTORE_FAILED','RTO_EXCEEDED','NONCE_REPLAY_DETECTED'
]);
const H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R174 offsite circuit breaker: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function createR174OffsiteCircuit({
 clock=()=>Date.now(),record,priorHead='0'.repeat(64),
 blocked=true
}={}){
 ok(typeof clock==='function'&&typeof record==='function'&&
  H64.test(priorHead)&&blocked===true,
  'closed-by-default controller with injected append-only ledger required');
 let head=priorHead,seq=0,stopped=true,busy=false;
 const append=async(type,{reason,commit,archiveSha256}={})=>{
  ok(!busy,'incident controller prohibits concurrent mutation');
  ok(typeof type==='string'&&
   (EVENTS.has(type)||type==='OPERATOR_RESET')&&
   /^[A-Z0-9_]{3,40}$/.test(reason||'')&&
   /^[a-f0-9]{40}$/.test(commit||'')&&
   H64.test(archiveSha256||''),
   'PII-free code, exact commit and archive fingerprint required');
  busy=true;
  try{
   const atMs=clock();
   ok(Number.isSafeInteger(atMs)&&atMs>0,'trusted log timestamp');
   const event=Object.freeze({
    schemaVersion:1,seq:seq+1,prevSha256:head,
    type,reason,commit,archiveSha256,atMs,
    productionAuthorized:false
   });
   const digest=sha(JSON.stringify(event));
   let written;
   try{written=await record({...event,sha256:digest});}
   catch{fail('durable incident record rejected');}
   ok(written?.accepted===true&&written.sha256===digest&&
    written.sequence===seq+1,
    'incident ledger not durably appended');
   seq++;
   head=digest;
   return Object.freeze({...event,sha256:digest});
  }finally{busy=false;}
 };
 async function trip({type,reason,commit,archiveSha256}={}){
  ok(EVENTS.has(type),'only enumerated offsite incident types supported');
  stopped=true;
  return append(type,{reason,commit,archiveSha256});
 }
 async function acknowledgeReset({reason,commit,archiveSha256,
  operatorApproved=false,reviewerApproved=false,
  evidenceSha256,verifiedCheckpointSha256}={}){
  ok(stopped===true&&operatorApproved===true&&
   reviewerApproved===true&&
   equal(evidenceSha256,verifiedCheckpointSha256),
   'operator+reviewer and exact independent checkpoint approval required');
  const audit=await append('OPERATOR_RESET',{
   reason,commit,archiveSha256
  });
  stopped=false;
  return Object.freeze({audit,operationalIsolatedOnly:true,
   productionAuthorized:false});
 }
 function requireClosed(){
  ok(stopped===true,'isolated offsite circuit is not stopped');
  return Object.freeze({closed:true,hash:head,sequence:seq,
   productionAuthorized:false});
 }
 return Object.freeze({
  trip,acknowledgeReset,requireClosed,
  snapshot:()=>Object.freeze({stopped,head,sequence:seq,
   autoRetryEnabled:false,productionAuthorized:false})
 });
}
export function verifyR174IncidentChain(events,{
 priorHead='0'.repeat(64)
}={}){
 ok(Array.isArray(events)&&events.length<=1000&&H64.test(priorHead),
  'bounded signed audit chain required');
 let hash=priorHead;
 for(let i=0;i<events.length;i++){
  const e=events[i];
  ok(e&&e.schemaVersion===1&&e.seq===i+1&&
   e.prevSha256===hash&&e.productionAuthorized===false&&
   (EVENTS.has(e.type)||e.type==='OPERATOR_RESET')&&
   /^[A-Z0-9_]{3,40}$/.test(e.reason||'')&&
   /^[a-f0-9]{40}$/.test(e.commit||'')&&H64.test(e.archiveSha256||''),
   'incident chain position or event altered');
  const {sha256:actual,...entry}=e;
  const calc=sha(JSON.stringify(entry));
  ok(equal(actual,calc),'incident SHA-256 chain broken');
  hash=calc;
 }
 return Object.freeze({valid:true,count:events.length,headSha256:hash,
  productionAuthorized:false});
}
