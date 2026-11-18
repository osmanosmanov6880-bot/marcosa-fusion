import test from 'node:test';
import assert from 'node:assert/strict';
import {requireR158Disposable,createR158CommandStore,createR158SessionChecker,R158_OPERATIONS} from '../r158/psql-command-adapter.mjs';

const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',
 PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'postgres',
 PGUSER:'marcosa_r158_ci',PGPASSWORD:'r158-ci-gateway-only',PATH:'/usr/bin:/bin'};
test('R158 forbids production, remote hosts and privileged DB connections',()=>{
 assert.equal(requireR158Disposable(env).PGUSER,'marcosa_r158_ci');
 for(const [field,value] of [
  ['GITHUB_ACTIONS','false'],['GITHUB_REPOSITORY','other/repository'],
  ['PGHOST','production.invalid'],['PGDATABASE','production'],
  ['PGUSER','postgres'],['PGPASSWORD','short']]){
  assert.throws(()=>requireR158Disposable({...env,[field]:value}),/R158/);
 }
});
test('R158 command contract refuses injection, invalid UUIDs and unknown SQL functions',async()=>{
 assert.deepEqual(R158_OPERATIONS,['edit','reorder','publish','publication','subscription','bookmark','attendance']);
 const store=createR158CommandStore({env});
 const actorId='15800000-0000-4158-8158-000000000001';
 const key='15800000-0000-4158-8158-000000000909';
 await assert.rejects(store.execute({actorId:'bad',name:'edit',key,data:{}}),e=>e.status===400);
 await assert.rejects(store.execute({actorId,name:'admin',key,data:{}}),e=>e.status===400);
 await assert.rejects(store.execute({actorId,name:'edit',key,
  data:{seriesId:'15800000-0000-4158-8158-000000000301',revision:0,
   title:"bad\0payload",description:''}}),e=>e.status===400);
});
test('R158 disconnected and malformed session inputs fail closed',async()=>{
 const checker=createR158SessionChecker({env:{...env,PGPASSWORD:'wrong-r158-password'}});
 assert.equal(await checker({sub:'15800000-0000-4158-8158-000000000001',
  sessionId:'15800000-0000-4158-8158-000000000501',expiresAt:1800000000}),false);
 assert.equal(await checker({sub:'invalid',sessionId:'invalid',expiresAt:1800000000}),false);
});
