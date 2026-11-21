/**
 * R159: server-side, per-mutation Supabase Auth session introspection.
 *
 * Supabase sessions docs: the verified JWT session_id maps to auth.sessions.id,
 * and a missing session indicates sign-out. JWT exp remains checked by R157.
 * This never trusts editable user_metadata and never uses service_role in JS.
 */
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SQL='SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1::uuid AND user_id=$2::uuid) AS active';
export const R159_SESSION_SQL=SQL;
export function createSupabaseSessionChecker({pool,clock=()=>Date.now(),timeoutMs=3000}={}){
 if(!pool||typeof pool.connect!=='function'||typeof clock!=='function'||
  !Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>5000)
  throw Error('R159 Auth: restricted PostgreSQL pool and bounded timeout required');
 return async({sub,sessionId,expiresAt}={})=>{
  if(typeof sub!=='string'||!uuid.test(sub)||typeof sessionId!=='string'||!uuid.test(sessionId)||
   !Number.isSafeInteger(expiresAt)||expiresAt<=Math.floor(clock()/1000))return false;
  let client,tx=false;
  try{
   client=await pool.connect();
   if(!client||typeof client.query!=='function'||typeof client.release!=='function')return false;
   await client.query('BEGIN READ ONLY');tx=true;
   await client.query("SET LOCAL statement_timeout = '"+timeoutMs+"ms'");
   await client.query('SET LOCAL ROLE marcosa_r159_auth_reader');
   const result=await client.query(SQL,[sessionId,sub]);
   if(result?.rows?.length!==1||result.rows[0].active!==true)return false;
   return true;
  }catch{
   return false;
  }finally{
   if(client&&tx)try{await client.query('ROLLBACK');}catch{}
   if(client)try{client.release();}catch{}
  }
 };
}
