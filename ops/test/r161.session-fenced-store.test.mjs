import test from 'node:test';
import assert from 'node:assert/strict';
import {createR161SessionFencedStore,R161_SESSION_FENCE_SQL} from '../r161/session-fenced-store.mjs';

const actor='16100000-0000-4161-8161-000000000001';
const session='16100000-0000-4161-8161-000000000002';
const season='16100000-0000-4161-8161-000000000003';
const key='16100000-0000-4161-8161-000000000004';
const request=()=>({actorId:actor,sessionId:session,
 authExpiresAt:Math.floor(Date.now()/1000)+600,name:'edit',key,
 data:{seriesId:season,revision:0,title:'Safe',description:'Fenced SQL'}});
function scenario({revokeAt=0}={}){
 let checks=0,commits=0,rollbacks=0,released=0,queries=[];
 const client={
  async query(sql,values){
   queries.push({sql,values});
   if(sql===R161_SESSION_FENCE_SQL){checks++;
    return{rows:[{active:revokeAt===0||checks<revokeAt}]};}
   if(sql.startsWith('SELECT marcosa_private.r156_edit_series'))
    return{rows:[{result:{revision:1}}]};
   if(sql==='COMMIT')commits++;
   if(sql==='ROLLBACK')rollbacks++;
   return{rows:[]};
  },release(){released++;}
 };
 return{pool:{connect:async()=>client},metrics:()=>({checks,commits,rollbacks,released,queries})};
}
test('R161 both session fences run inside ONE trusted SQL transaction with rollback-safe roles',async()=>{
 const f=scenario(),store=createR161SessionFencedStore({pool:f.pool});
 assert.equal((await store.execute(request())).revision,1);
 const m=f.metrics();
 assert.equal(m.checks,2);assert.equal(m.commits,1);assert.equal(m.rollbacks,0);
 assert.equal(m.released,1);
 assert.equal(m.queries.filter(x=>x.sql==='SET LOCAL ROLE marcosa_r159_auth_reader').length,2);
 assert.equal(m.queries.filter(x=>x.sql==='SET LOCAL ROLE marcosa_r156_writer').length,3);
 assert.deepEqual(m.queries.filter(x=>x.sql===R161_SESSION_FENCE_SQL)
  .map(x=>x.values),[[session,actor],[session,actor]]);
});
test('R161 session revoked after SQL mutation but before COMMIT triggers ROLLBACK',async()=>{
 const f=scenario({revokeAt:2});
 const s=createR161SessionFencedStore({pool:f.pool});
 await assert.rejects(s.execute(request()),error=>error.status===401);
 const m=f.metrics();
 assert.equal(m.checks,2);assert.equal(m.commits,0);assert.equal(m.rollbacks,1);
 assert.equal(m.released,1);
 assert.ok(m.queries.some(x=>x.sql.includes('r156_edit_series')));
});
test('R161 missing, expired or invalid signed session rejects before mutation',async()=>{
 const f=scenario(),s=createR161SessionFencedStore({pool:f.pool});
 for(const update of [
  {sessionId:'bad'},
  {sessionId:undefined},
  {authExpiresAt:Math.floor(Date.now()/1000)-30},
  {authExpiresAt:null}
 ]){
  await assert.rejects(s.execute({...request(),...update}),error=>error.status===401);
 }
 assert.equal(f.metrics().commits,0);
 assert.equal(f.metrics().rollbacks,4);
 assert.equal(f.metrics().queries.filter(x=>x.sql.includes('r156_edit_series')).length,0);
});
test('R161 database fault refuses all writes and rolls back',async()=>{
 let releases=0,rollbacks=0,commits=0;
 const pool={connect:async()=>({async query(sql){
  if(sql===R161_SESSION_FENCE_SQL)throw Error('DB disconnected');
  if(sql==='ROLLBACK')rollbacks++;
  if(sql==='COMMIT')commits++;
  return{rows:[]};
 },release(){releases++;}})};
 await assert.rejects(createR161SessionFencedStore({pool}).execute(request()),e=>e.status===503);
 assert.equal(rollbacks,1);assert.equal(commits,0);assert.equal(releases,1);
});
