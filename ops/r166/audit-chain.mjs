/**
 * R166 durable privacy-minimized PostgreSQL hash chain.
 * Advisory locks are not enough: SELECT ... FOR UPDATE serializes the
 * singleton head, and the entry + head update COMMIT atomically.
 * No external immutability claim without an independently signed anchor.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const EVENTS=new Set(['nonce_consumed','quarantine_closed','archive_encrypted',
 'restore_verified','restart_verified','integrity_denied']);
const RESULTS=new Set(['ok','deny','blocked']);
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const ZERO='0'.repeat(64);
const fail=m=>{throw Error('R166 audit: '+m);};
const valid=(x,m)=>{if(!x)fail(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
export const R166_HEAD_LOCK_SQL=
 'SELECT seq,head_sha256 FROM marcosa_private.r166_audit_head WHERE id=1 FOR UPDATE';
export const R166_HEAD_READ_SQL=
 'SELECT seq,head_sha256 FROM marcosa_private.r166_audit_head WHERE id=1';
export const R166_EVENTS_READ_SQL=
 'SELECT seq,observed_at_ms,category,outcome,source_commit,prev_sha256,entry_sha256 '+
 'FROM marcosa_private.r166_audit_events ORDER BY seq';
export const R166_EVENT_INSERT_SQL=
 'INSERT INTO marcosa_private.r166_audit_events '+
 '(seq,observed_at_ms,category,outcome,source_commit,prev_sha256,entry_sha256) '+
 'VALUES ($1::bigint,$2::bigint,$3::text,$4::text,$5::text,$6::text,$7::text)';
export const R166_HEAD_UPDATE_SQL=
 'UPDATE marcosa_private.r166_audit_head SET seq=$1::bigint,head_sha256=$2::text '+
 'WHERE id=1 AND seq=$3::bigint AND head_sha256=$4::text RETURNING seq';
function canonical(x){
 return JSON.stringify({schemaVersion:1,seq:x.seq,atMs:x.atMs,
  category:x.category,outcome:x.outcome,commit:x.commit,prev:x.prev});
}
export function r166HashEntry(entry){return hash(canonical(entry));}
function entryCheck({category,outcome,commit}){
 valid(EVENTS.has(category)&&RESULTS.has(outcome)&&H40.test(commit||''),
  'fixed nonpersonal event, outcome and full SHA required');
}
function receipt(x){return Object.freeze({...x,productionAuthorized:false});}
export function verifyR166Snapshot(snapshot,{expectedHead,commit}={}){
 valid(snapshot&&Object.getPrototypeOf(snapshot)===Object.prototype&&
  Object.keys(snapshot).sort().join(',')==='entries,head,productionAuthorized,seq',
  'strict audit snapshot');
 valid(snapshot.productionAuthorized===false&&
  Number.isSafeInteger(snapshot.seq)&&snapshot.seq>=0&&snapshot.seq<=1000000&&
  H64.test(snapshot.head||'')&&Array.isArray(snapshot.entries)&&
  snapshot.entries.length===snapshot.seq&&snapshot.entries.length<=256,
  'complete bounded chain required');
 let prev=ZERO;
 for(let i=0;i<snapshot.entries.length;i++){
  const e=snapshot.entries[i];
  valid(e&&Object.getPrototypeOf(e)===Object.prototype&&
   Object.keys(e).sort().join(',')==='atMs,category,commit,hash,outcome,prev,seq',
   'strict nonpersonal audit event');
  entryCheck(e);
  valid(e.seq===i+1&&Number.isSafeInteger(e.atMs)&&e.atMs>0&&
   e.prev===prev&&H64.test(e.hash||'')&&r166HashEntry(e)===e.hash,
   'event or chain hash mismatch');
  if(commit!==undefined)valid(e.commit===commit,'commit changed within audit');
  prev=e.hash;
 }
 valid(prev===snapshot.head,'head mismatch');
 if(expectedHead!==undefined){
  valid(H64.test(expectedHead),'independent external anchor must be 64 hex');
  valid(timingSafeEqual(Buffer.from(expectedHead,'hex'),Buffer.from(prev,'hex')),
   'external anchor and PostgreSQL head disagree');
 }
 return receipt({matched:true,head:prev,events:snapshot.seq,
  anchored:expectedHead!==undefined,syntheticCi:true});
}
export function createR166AuditChain({pool,clock=()=>Date.now(),commit}={}){
 valid(pool&&typeof pool.connect==='function'&&typeof clock==='function'&&
  H40.test(commit||''),'trusted PostgreSQL pool, clock and source SHA');
 async function append({category,outcome}={}){
  entryCheck({category,outcome,commit});
  let client,active=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN');active=true;
   await client.query("SET LOCAL statement_timeout='4000ms'");
   await client.query('SET LOCAL ROLE marcosa_r166_audit_writer');
   const h=await client.query(R166_HEAD_LOCK_SQL);
   valid(h?.rows?.length===1,'single durable audit head required');
   const before=Number(h.rows[0].seq),prev=h.rows[0].head_sha256;
   valid(Number.isSafeInteger(before)&&before>=0&&before<256&&H64.test(prev),
    'bounded linear history and predecessor required');
   const atMs=clock(),seq=before+1;
   valid(Number.isSafeInteger(atMs)&&atMs>0,'trusted numeric audit clock');
   const event={seq,atMs,category,outcome,commit,prev};
   const digest=r166HashEntry(event);
   await client.query(R166_EVENT_INSERT_SQL,[seq,atMs,category,outcome,commit,prev,digest]);
   const upd=await client.query(R166_HEAD_UPDATE_SQL,[seq,digest,before,prev]);
   valid(upd?.rows?.length===1,'concurrent audit head update refused');
   await client.query('COMMIT');active=false;
   return receipt({seq,head:digest,category,syntheticCi:true});
  }catch{
   if(client&&active)try{await client.query('ROLLBACK');}catch{}
   fail('transaction denied or database unavailable');
  }finally{if(client)try{client.release();}catch{}}
 }
 async function snapshot(){
  let client,active=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
   await client.query("SET LOCAL statement_timeout='4000ms'");
   await client.query('SET LOCAL ROLE marcosa_r166_audit_reader');
   const h=await client.query(R166_HEAD_READ_SQL);
   const events=await client.query(R166_EVENTS_READ_SQL);
   valid(h?.rows?.length===1&&Array.isArray(events?.rows),'audit rows unavailable');
   const data={seq:Number(h.rows[0].seq),head:h.rows[0].head_sha256,
    entries:events.rows.map(x=>({seq:Number(x.seq),atMs:Number(x.observed_at_ms),
     category:x.category,outcome:x.outcome,commit:x.source_commit,
     prev:x.prev_sha256,hash:x.entry_sha256})),productionAuthorized:false};
   verifyR166Snapshot(data,{commit});
   await client.query('ROLLBACK');active=false;
   return data;
  }catch{
   if(client&&active)try{await client.query('ROLLBACK');}catch{}
   fail('audit readback denied or history inconsistent');
  }finally{if(client)try{client.release();}catch{}}
 }
 return Object.freeze({append,snapshot});
}
