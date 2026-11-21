import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R153 consent marks can be erased one-by-one during freeze without affecting another user',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'marcosa-r153-consent-'));
 const dbPath=join(temp,'app.sqlite'),inviteCode='r153-consent-invite';
 let app=createApp({databasePath:dbPath,inviteCode});
 let base='';
 async function start(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}
 async function req(path,cookie='',method='GET',body,origin=base){
  const response=await fetch(base+'/api'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const auth={username:name,email:name+'@example.org',password:'r153-consent-password',inviteCode};
  assert.equal((await req('/auth/register','','POST',auth)).status,201);
  const login=await req('/auth/login','','POST',auth);
  return{cookie:login.cookie,world:(await req('/auth/me',login.cookie)).json.worlds[0].id};
 }
 try{
  await start();
  const owner=await account('ownerconsent153'),reader=await account('readerconsent153'),another=await account('anotherconsent153');
  const slug='privacy-chapters',path='/series/'+slug;
  assert.equal((await req('/series',owner.cookie,'POST',{worldId:owner.world,slug,title:'Privacy chapters'})).status,201);
  const ids=[];
  for(let i=0;i<2;i++){
   const post=await req('/posts',owner.cookie,'POST',{worldId:owner.world,body:'Text '+i,status:'published'});
   const added=await req(path+'/episodes',owner.cookie,'POST',{postId:post.json.id,title:'Chapter '+i});
   assert.equal(added.status,201);ids.push(added.json.id);
  }
  for(const person of [reader,another])for(const episodeId of ids)
   assert.equal((await req(path+'/metrics/attendance',person.cookie,'POST',{episodeId,consent:true})).status,200);
  assert.equal((await req(path+'/metrics/attendance/'+ids[0],reader.cookie,'DELETE',{extra:true})).status,400);
  assert.equal((await req(path+'/metrics/attendance/'+ids[0],reader.cookie,'DELETE',{},'https://bad.example')).status,403);
  assert.equal((await req(path+'/metrics/attendance/'+ids[0],reader.cookie,'DELETE',{})).json.erased,true);
  assert.equal((await req(path+'/metrics/attendance/'+ids[0],reader.cookie,'DELETE',{})).json.erased,false);
  let own=(await req(path+'/metrics/attendance',reader.cookie)).json.episodes;
  assert.deepEqual(own.map(e=>e.marked),[false,true]);
  assert.deepEqual((await req(path+'/metrics/attendance',another.cookie)).json.episodes.map(e=>e.marked),[true,true]);
  assert.equal((await req(path+'/metrics/attendance/'+ids[1],owner.cookie,'DELETE',{})).json.erased,false);
  await app.close();app=createApp({databasePath:dbPath,inviteCode,contentWritesDisabled:true});await start();
  assert.equal((await req(path+'/metrics/attendance',reader.cookie,'POST',{episodeId:ids[0],consent:true})).status,503);
  assert.equal((await req(path+'/metrics/attendance/'+ids[1],reader.cookie,'DELETE',{})).status,200);
  assert.equal((await req(path+'/metrics/attendance',another.cookie)).json.episodes.every(e=>e.marked),true);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM series_attendance').get().n,2);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();rmSync(temp,{recursive:true,force:true});}
});
