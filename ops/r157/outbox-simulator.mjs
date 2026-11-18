/**
 * R157 synthetic-only outbox simulator. NEVER talks to mail, webhooks or SMS.
 * For production a separate delivery implementation, independent review,
 * recipient-consent recheck and external idempotency agreement are required.
 */
const workerPattern=/^[a-z][a-z0-9_-]{3,39}$/;
export function assertR157Disposable(env){
 if(env.GITHUB_ACTIONS!=='true'||
  env.GITHUB_REPOSITORY!=='osmanosmanov6880-bot/marcosa-fusion'||
  env.PGHOST!=='127.0.0.1'||env.PGPORT!=='5432'||
  env.PGDATABASE!=='postgres'||env.PGUSER!=='postgres')
  throw Error('R157 outbox simulator requires isolated CI PostgreSQL 17 on loopback');
 return true;
}
export function createOutboxSimulator({pool,env,afterClaim}={}){
 assertR157Disposable(env||{});
 if(!pool||typeof pool.connect!=='function'||
  (afterClaim!==undefined&&typeof afterClaim!=='function'))
  throw Error('R157 requires a checked, server-only PostgreSQL pool');
 async function transaction(sql,params=[]){
  let client,active=false;
  try{
   client=await pool.connect();
   if(!client||typeof client.query!=='function'||typeof client.release!=='function')
    throw Error('Invalid dispatcher client');
   await client.query('BEGIN');active=true;
   await client.query("SET LOCAL statement_timeout = '4000ms'");
   await client.query('SET LOCAL ROLE marcosa_r156_dispatcher');
   const result=await client.query(sql,params);
   await client.query('COMMIT');active=false;
   return result;
  }catch(error){
   if(active&&client){try{await client.query('ROLLBACK');}catch{}}
   throw Error('R157 dispatcher query failed');
  }finally{if(client){try{client.release();}catch{}}}
 }
 async function boolean(sql,params){
  const out=await transaction(sql,params);
  if(!out||!Array.isArray(out.rows)||out.rows.length!==1)
   throw Error('R157 dispatcher boolean contract error');
  return out.rows[0]?.allowed===true;
 }
 return Object.freeze({
  async health(){
   const out=await transaction('SELECT marcosa_private.r157_queue_health() AS status');
   return out.rows?.[0]?.status;
  },
  async sweep(limit=100){
   if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('Invalid sweep limit');
   const out=await transaction('SELECT marcosa_private.r157_sweep($1::integer) AS swept',[limit]);
   return Number(out.rows?.[0]?.swept);
  },
  async simulateOnce({workerId='simulator_r157',max=10,leaseSeconds=60}={}){
   if(!workerPattern.test(workerId)||!Number.isInteger(max)||max<1||max>50||
    !Number.isInteger(leaseSeconds)||leaseSeconds<5||leaseSeconds>600)
    throw Error('Invalid R157 claim arguments');
   const claimed=await transaction(
    'SELECT * FROM marcosa_private.r156_claim($1::text,$2::integer,$3::integer)',
    [workerId,max,leaseSeconds]);
   if(!Array.isArray(claimed?.rows))throw Error('Missing dispatcher claim rows');
   const result={simulationOnly:true,externalMessagesSent:0,
    claimed:claimed.rows.length,acknowledged:0,cancelled:0,failed:0};
   for(const row of claimed.rows){
    if(!Number.isSafeInteger(Number(row.id))||!row.lease_token)throw Error('Invalid lease receipt');
    try{
     if(afterClaim)await afterClaim(Object.freeze({id:row.id,episodeId:row.episode_id,
      userId:row.user_id}));
     const allowed=await boolean(
      'SELECT marcosa_private.r157_delivery_fence($1::bigint,$2::uuid) AS allowed',
      [row.id,row.lease_token]);
     if(!allowed){
      const cancelled=await boolean(
       'SELECT marcosa_private.r157_cancel($1::bigint,$2::uuid) AS allowed',
       [row.id,row.lease_token]);
      if(cancelled)result.cancelled++;
      else result.failed++;
      continue;
     }
     // The only "delivery" is a transient in-memory simulation. It is not
     // a customer notification and MUST NOT count as an externally sent job.
     const acknowledged=await boolean(
      'SELECT marcosa_private.r156_ack($1::bigint,$2::uuid) AS allowed',
      [row.id,row.lease_token]);
     if(acknowledged)result.acknowledged++;
     else result.failed++;
    }catch{
     result.failed++;
     try{await boolean('SELECT marcosa_private.r156_nack($1::bigint,$2::uuid) AS allowed',
      [row.id,row.lease_token]);}catch{}
    }
   }
   return Object.freeze(result);
  }
 });
}
