/**
 * R161: re-check verified JWT session_id INSIDE the same SQL transaction,
 * immediately before the writer mutation and again before COMMIT.
 * No real auth refresh token is read, stored or exposed to browser code.
 *
 * Does NOT assert perfect serializability with a concurrent auth.sessions
 * deletion occurring AFTER the last check; the managed table has its own
 * revocation semantics. This closes the known HTTP->SQL race in R160.
 */
import {createCommandStore,CommandStoreError} from '../r157/pg-command-store.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SQL='SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid) AS active';
export const R161_SESSION_FENCE_SQL=SQL;

function denial(){return new CommandStoreError('Authenticated session no longer active',401);}
export function createR161SessionFencedStore({pool,clock=()=>Date.now(),onAfterQuery}={}){
 if(!pool||typeof pool.connect!=='function'||typeof clock!=='function'||
  (onAfterQuery!==undefined&&typeof onAfterQuery!=='function'))
  throw Error('R161 session fence requires trusted pool and clock');
 async function check({client,actorId,sessionId,authExpiresAt}){
  if(typeof actorId!=='string'||!uuid.test(actorId)||
   typeof sessionId!=='string'||!uuid.test(sessionId)||
   !Number.isSafeInteger(authExpiresAt)||
   authExpiresAt<=Math.floor(clock()/1000))throw denial();
  try{
   await client.query('SET LOCAL ROLE marcosa_r159_auth_reader');
   const r=await client.query(SQL,[sessionId,actorId]);
   if(r?.rows?.length!==1||r.rows[0]?.active!==true)throw denial();
   await client.query('SET LOCAL ROLE marcosa_r156_writer');
  }catch(e){
   if(e instanceof CommandStoreError)throw e;
   throw new CommandStoreError('Session validation unavailable',503);
  }
 }
 return createCommandStore({
  pool,onBeforeQuery:check,onBeforeCommit:check,onAfterQuery
 });
}
