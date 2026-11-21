/**
 * R162 privacy-minimized append-only in-memory operations evidence.
 * Each record binds to the previous hash. A remote independent head seal is
 * REQUIRED to detect replacement of the complete ledger; not a legal audit.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const EVENT=new Set([
 'staging_start','staging_rollback','staging_drain','preflight_passed',
 'preflight_denied','jwks_expired','release_verified',
 'session_revoked','inbox_deduplicated','restore_verified'
]);
const RESULT=new Set(['ok','deny','retry','blocked']);
const PHASE=new Set(['prepare','boot','runtime','shutdown','recovery','verification']);
const sha=s=>createHash('sha256').update(s).digest('hex');
const ZERO='0'.repeat(64);
const fail=m=>{throw Error('R162 audit: '+m);};
function valid(record){
 if(!record||typeof record!=='object'||Array.isArray(record)||
  Object.keys(record).sort().join(',')!=='event,phase,result')fail('only non-PII categorical fields accepted');
 if(!EVENT.has(record.event)||!RESULT.has(record.result)||!PHASE.has(record.phase))
  fail('unknown event or result; arbitrary data is forbidden');
}
function canonical(x){
 return JSON.stringify({seq:x.seq,at:x.at,event:x.event,
  phase:x.phase,result:x.result,prevHash:x.prevHash});
}
export function verifyR162IncidentSnapshot(snapshot,{expectedHead}={}){
 if(!snapshot||typeof snapshot!=='object'||
  !Array.isArray(snapshot.entries)||typeof snapshot.anchor!=='string'||
  !/^[a-f0-9]{64}$/.test(snapshot.anchor)||
  !Number.isSafeInteger(snapshot.total)||snapshot.total<0||
  typeof snapshot.head!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.head))
  fail('invalid exported chain');
 if(!Array.isArray(snapshot.entries)||snapshot.entries.length>200)
  fail('unbounded evidence stream');
 let prev=snapshot.anchor,prior=0;
 for(let i=0;i<snapshot.entries.length;i++){
  const x=snapshot.entries[i];
  valid({event:x.event,phase:x.phase,result:x.result});
  if(!Number.isSafeInteger(x.seq)||x.seq<=prior||
   !Number.isSafeInteger(x.at)||x.at<0||
   x.prevHash!==prev||x.hash!==sha(canonical(x))||
   Object.keys(x).sort().join(',')!=='at,event,hash,phase,prevHash,result,seq')
   fail('incident record tampered');
  prev=x.hash;prior=x.seq;
 }
 if(prev!==snapshot.head||
  (snapshot.entries.length&&prior!==snapshot.total)||
  (!snapshot.entries.length&&snapshot.anchor!==snapshot.head))
  fail('inconsistent chain head');
 if(expectedHead!==undefined){
  if(typeof expectedHead!=='string'||!/^[a-f0-9]{64}$/.test(expectedHead))
   fail('expected external anchor invalid');
  if(!timingSafeEqual(Buffer.from(expectedHead,'hex'),Buffer.from(snapshot.head,'hex')))
   fail('independently anchored head mismatch');
 }
 return Object.freeze({consistent:true,independentlyAnchored:expectedHead!==undefined,
  retained:snapshot.entries.length,total:snapshot.total,head:snapshot.head,
  productionAuthorized:false});
}
export function createR162IncidentLedger({clock=()=>Date.now(),limit=100}={}){
 if(typeof clock!=='function'||!Number.isInteger(limit)||limit<4||limit>200)
  fail('bounded clock and capacity required');
 let entries=[],anchor=ZERO,head=ZERO,total=0,lastAt=0;
 const snapshot=()=>Object.freeze({schemaVersion:1,
  anchor,head,total,entries:entries.map(x=>Object.freeze({...x})),
  productionAuthorized:false});
 return Object.freeze({
  append(event){
   valid(event);
   let at=clock();
   if(!Number.isSafeInteger(at)||at<0)fail('invalid clock');
   at=Math.max(at,lastAt);
   lastAt=at;
   const base={seq:++total,at,...event,prevHash:head};
   const hash=sha(canonical(base));
   head=hash;
   entries.push(Object.freeze({...base,hash}));
   if(entries.length>limit)anchor=entries.shift().hash;
   return Object.freeze({seq:total,head,productionAuthorized:false});
  },
  snapshot,
  verify:(expectedHead)=>verifyR162IncidentSnapshot(snapshot(),{expectedHead}),
  metrics:()=>Object.freeze({retained:entries.length,total,
   head,productionAuthorized:false})
 });
}
