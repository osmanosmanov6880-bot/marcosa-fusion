/**
 * R165: fail-closed durable quarantine checked inside every trusted mutation.
 * Only a trusted fixture administrator may reopen in disposable CI.
 * A real Supabase deployment must independently review role grants and policy.
 */
import {createR161SessionFencedStore} from '../r161/session-fenced-store.mjs';
import {CommandStoreError} from '../r157/pg-command-store.mjs';

export const R165_GATE_SQL=
 'SELECT closed,generation FROM marcosa_private.r165_quarantine WHERE id=1';
const guard=(v,m)=>{if(!v)throw Error('R165 quarantine: '+m);};
export function createR165QuarantineFence(){
 return async({client})=>{
  try{
   await client.query('SET LOCAL ROLE marcosa_r165_gate_reader');
   const result=await client.query(R165_GATE_SQL);
   if(result?.rows?.length!==1||result.rows[0].closed!==false||
    !Number.isSafeInteger(Number(result.rows[0].generation))||
    Number(result.rows[0].generation)<1)
    throw new CommandStoreError('Operator quarantine closed',503);
   await client.query('SET LOCAL ROLE marcosa_r156_writer');
  }catch(e){
   if(e instanceof CommandStoreError)throw e;
   throw new CommandStoreError('Operator quarantine unavailable',503);
  }
 };
}
export function createR165QuarantinedStore({pool,clock,onAfterQuery}={}){
 guard(pool&&typeof pool.connect==='function','restricted pool required');
 return createR161SessionFencedStore({pool,clock,onAfterQuery,
  onFence:createR165QuarantineFence()});
}
export function createR165QuarantineControl({pool}={}){
 guard(pool&&typeof pool.connect==='function','restricted pool required');
 async function close(){
  let client,started=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN');started=true;
   await client.query("SET LOCAL statement_timeout='3500ms'");
   await client.query('SET LOCAL ROLE marcosa_r165_gate_closer');
   const r=await client.query(
    'UPDATE marcosa_private.r165_quarantine SET closed=true, '+
    'generation=generation+1,changed_at=clock_timestamp() '+
    'WHERE id=1 AND closed=false RETURNING generation');
   await client.query('COMMIT');started=false;
   return Object.freeze({closed:true,changed:r?.rows?.length===1,
    generation:r?.rows?.length===1?Number(r.rows[0].generation):null,
    canReopen:false,productionAuthorized:false});
  }catch{
   if(client&&started)try{await client.query('ROLLBACK');}catch{}
   // Unknown outcome must never be reported as safely closed.
   throw Error('R165 quarantine: closure unverified');
  }finally{if(client)try{client.release();}catch{}}
 }
 async function status(){
  let client,started=false;
  try{
   client=await pool.connect();
   await client.query('BEGIN READ ONLY');started=true;
   await client.query('SET LOCAL ROLE marcosa_r165_gate_reader');
   const r=await client.query(R165_GATE_SQL);
   await client.query('ROLLBACK');started=false;
   if(r?.rows?.length!==1||typeof r.rows[0].closed!=='boolean')throw Error('bad gate');
   return Object.freeze({closed:r.rows[0].closed,
    generation:Number(r.rows[0].generation),productionAuthorized:false});
  }catch{
   if(client&&started)try{await client.query('ROLLBACK');}catch{}
   return Object.freeze({closed:true,state:'unknown',productionAuthorized:false});
  }finally{if(client)try{client.release();}catch{}}
 }
 return Object.freeze({close,status});
}
