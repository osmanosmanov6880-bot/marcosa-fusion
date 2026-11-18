/**
 * R157 injected-node-postgres-compatible transaction adapter.
 * The pool must be provided by a server-only trusted process; this module
 * never reads DATABASE_URL or exposes a service-role key to the browser.
 * Never interpolate user values into SQL or reuse a JWT GUC across a pooled
 * connection: SET LOCAL ROLE and session context expire on COMMIT/ROLLBACK.
 */
const queries=Object.freeze({
 edit:{
  sql:'SELECT marcosa_private.r156_edit_series($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::uuid) AS result',
  args:(actor,d,key)=>[actor,d.seriesId,d.revision,d.title,d.description,key]
 },
 reorder:{
  sql:'SELECT marcosa_private.r156_reorder_episodes($1::uuid,$2::uuid,$3::bigint,$4::uuid[],$5::uuid) AS result',
  args:(actor,d,key)=>[actor,d.seriesId,d.revision,d.order,key]
 },
 publish:{
  sql:'SELECT marcosa_private.r156_publish_episode($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::bigint,$7::uuid) AS result',
  args:(actor,d,key)=>[actor,d.seriesId,d.postId,d.episodeId,d.title,d.revision,key]
 },
 publication:{
  sql:'SELECT marcosa_private.r156_publication($1::uuid,$2::uuid,$3::boolean,$4::bigint,$5::uuid) AS result',
  args:(actor,d,key)=>[actor,d.seriesId,d.publish,d.revision,key]
 },
 subscription:{
  sql:'SELECT marcosa_private.r156_subscription($1::uuid,$2::uuid,$3::text,$4::uuid) AS result',
  args:(actor,d,key)=>[actor,d.seriesId,d.mode,key]
 },
 bookmark:{
  sql:'SELECT marcosa_private.r156_bookmark($1::uuid,$2::uuid,$3::boolean,$4::uuid) AS result',
  args:(actor,d,key)=>[actor,d.episodeId,d.save,key]
 },
 attendance:{
  sql:'SELECT marcosa_private.r156_attendance($1::uuid,$2::uuid,$3::boolean,$4::uuid) AS result',
  args:(actor,d,key)=>[actor,d.episodeId,d.present,key]
 }
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const R157_OPERATIONS=Object.freeze(Object.keys(queries));

export class CommandStoreError extends Error {
 constructor(message,status){super(message);this.name='CommandStoreError';this.status=status;}
}
function failure(err){
 if(err instanceof CommandStoreError)return err;
 const code=err?.code;
 if(['23505','23503','23514','40001','40P01','P0001'].includes(code))
  return new CommandStoreError('Command conflicts with current state',409);
 if(code==='42501')return new CommandStoreError('Not authorized for this command',403);
 return new CommandStoreError('Database operation unavailable',503);
}
/** Pool is expected to implement async connect() -> {query(sql,values),release()} */
export function createCommandStore({pool,onAfterQuery,onBeforeQuery,onBeforeCommit}={}){
 if(!pool||typeof pool.connect!=='function'||
  [onAfterQuery,onBeforeQuery,onBeforeCommit].some(x=>x!==undefined&&typeof x!=='function'))
  throw Error('R157 requires a server-owned PostgreSQL pool');
 return Object.freeze({
  async execute({actorId,name,data,key}={}){
   if(typeof actorId!=='string'||!uuid.test(actorId)||
    typeof key!=='string'||!uuid.test(key)||!Object.hasOwn(queries,name)||
    !data||typeof data!=='object'||Array.isArray(data))
    throw new CommandStoreError('Invalid command contract',400);
   const op=queries[name];
   const args=op.args(actorId,data,key);
   let client,started=false;
   try{
    client=await pool.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
     throw Error('Invalid transaction client');
    await client.query('BEGIN');
    started=true;
    // Prevent unbounded work and stale session context on a returned connection.
    await client.query("SET LOCAL statement_timeout = '4000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '6000ms'");
    await client.query('SET LOCAL ROLE marcosa_r156_writer');
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actorId]);
    const result=await client.query(op.sql,args);
    if(!result||!Array.isArray(result.rows)||result.rows.length!==1||
      !result.rows[0]||typeof result.rows[0].result!=='object'||
      result.rows[0].result===null||Array.isArray(result.rows[0].result))
     throw Error('Unexpected PostgreSQL response contract');
    if(onAfterQuery)await onAfterQuery({name,actorId,result:result.rows[0].result});
    await client.query('COMMIT');
    started=false;
    return result.rows[0].result;
   }catch(err){
    if(client&&started){
     try{await client.query('ROLLBACK');}catch{ /* Never expose rollback errors */ }
    }
    throw failure(err);
   }finally{
    if(client){
     try{client.release();}catch{ /* Do not reveal pool failures to HTTP */ }
    }
   }
  }
 });
}
