import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R154 editorial journal: owner-only, transactional, keyset, idempotent, export and archive audit',async()=>{
 const app=createApp({inviteCode:'r154-audit-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function req(path,cookie='',method='GET',body){
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function person(name){
  const auth={username:name,email:name+'@example.org',password:'safe-audit-password-2026',inviteCode:'r154-audit-invite'};
  assert.equal((await req('/auth/register','','POST',auth)).status,201);
  const login=await req('/auth/login','','POST',auth);
  return{cookie:login.cookie,world:(await req('/auth/me',login.cookie)).json.worlds[0].id};
 }
 try{
  const owner=await person('r154historyowner'),other=await person('r154historyother');
  const slug='journal-154',path='/series/'+slug;
  assert.equal((await req('/series',owner.cookie,'POST',{worldId:owner.world,slug,title:'Editorial Journal'})).status,201);
  const post=await req('/posts',owner.cookie,'POST',{worldId:owner.world,status:'published',body:'Original chapter body'});
  assert.equal((await req(path+'/episodes',owner.cookie,'POST',{postId:post.json.id,title:'Chapter A'})).status,201);
  const detail=(await req(path,owner.cookie)).json.episodes[0],editor=path+'/episodes/'+detail.id;
  assert.equal((await req(path,owner.cookie,'PATCH',{title:'Editorial Journal 2'})).status,200);
  assert.equal((await req(editor,owner.cookie,'PATCH',{title:'Chapter B'})).status,200);
  assert.equal((await req(editor,owner.cookie,'PATCH',{title:'Chapter B'})).status,200);
  assert.equal((await req(path+'/episodes/order',owner.cookie,'PUT',{order:[9999]})).status,409);
  assert.equal((await req(path+'/publication',owner.cookie,'DELETE',{})).status,200);
  assert.equal((await req(path+'/publication',owner.cookie,'DELETE',{})).status,200);
  assert.equal((await req(path+'/publication',owner.cookie,'POST',{})).status,200);
  assert.equal((await req(path+'/audit',other.cookie)).status,404);
  assert.equal((await req(path+'/audit')).status,401);
  const actions=(await req(path+'/audit',owner.cookie)).json.items.map(x=>x.action);
  assert.deepEqual(actions,[
   'series_restored','series_archived','episode_renamed','series_updated','episode_attached','series_created'
  ]);
  const page1=(await req(path+'/audit?limit=2',owner.cookie)).json;
  const page2=(await req(path+'/audit?limit=2&cursor='+page1.nextCursor,owner.cookie)).json;
  assert.equal(page1.items.length,2);
  assert.equal(page2.items.length,2);
  assert.equal(new Set([...page1.items,...page2.items].map(x=>x.id)).size,4);
  assert.equal((await req(path+'/audit?limit=51',owner.cookie)).status,400);
  assert.equal((await req(path+'/audit?cursor=1%20OR%201=1',owner.cookie)).status,400);
  const data=(await req('/account/export',owner.cookie)).json;
  assert.equal(data.seasonEditorialHistory.length,6);
  assert.doesNotMatch(JSON.stringify(data.seasonEditorialHistory),/r154historyother/);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
