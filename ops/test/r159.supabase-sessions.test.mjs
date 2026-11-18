import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseSessionChecker,R159_SESSION_SQL} from '../r159/supabase-sessions.mjs';
const id='15900000-0000-4159-8159-000000000001',sid='15900000-0000-4159-8159-000000000002';
const future=Math.floor(Date.now()/1000)+300;
function fakePool({active=true,throwsAt}={}){
 const queries=[],released=[];
 return{
  queries,released,
  async connect(){
   if(throwsAt==='connect')throw Error('offline');
   return{
    async query(sql,params){
     queries.push({sql,params});
     if(throwsAt&&sql.includes(throwsAt))throw Error('injected');
     if(sql.includes('SELECT EXISTS'))return{rows:[{active}]};
     return{rows:[]};
    },release(){released.push(true);}
   };
  }
 };
}
test('R159 verifies session+subject in one parameterized query and clears role',async()=>{
 const pool=fakePool(),checker=createSupabaseSessionChecker({pool});
 assert.equal(await checker({sub:id,sessionId:sid,expiresAt:future}),true);
 assert.deepEqual(pool.queries.map(x=>x.sql),[
  'BEGIN READ ONLY',"SET LOCAL statement_timeout = '3000ms'",
  'SET LOCAL ROLE marcosa_r159_auth_reader',R159_SESSION_SQL,'ROLLBACK'
 ]);
 assert.deepEqual(pool.queries[3].params,[sid,id]);
 assert.equal(pool.released.length,1);
});
test('R159 fail-closed on deleted, revoked/missing, unavailable session and invalid inputs',async()=>{
 for(const opts of [{active:false},{throwsAt:'SELECT EXISTS'},{throwsAt:'SET LOCAL ROLE'},{throwsAt:'connect'}]){
  const pool=fakePool(opts),checker=createSupabaseSessionChecker({pool});
  assert.equal(await checker({sub:id,sessionId:sid,expiresAt:future}),false);
 }
 const pool=fakePool(),checker=createSupabaseSessionChecker({pool});
 for(const value of [{sub:'fake',sessionId:sid,expiresAt:future},
  {sub:id,sessionId:'wrong',expiresAt:future},
  {sub:id,sessionId:sid,expiresAt:Math.floor(Date.now()/1000)-1}])
  assert.equal(await checker(value),false);
 assert.equal(pool.queries.length,0);
});
test('R159 SQL never touches email, metadata, raw session tokens, or accepts unvalidated role',()=>{
 assert.match(R159_SESSION_SQL,/auth\.sessions/);
 assert.match(R159_SESSION_SQL,/id=\$1::uuid AND user_id=\$2::uuid/);
 assert.doesNotMatch(R159_SESSION_SQL,/email|metadata|refresh_token|session_token|service_role/i);
 assert.throws(()=>createSupabaseSessionChecker({pool:{},timeoutMs:100}),/restricted PostgreSQL/);
});
