import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('R153 season editor enforces ownership, validation, atomic position changes and cascade removal',async()=>{
 const app=createApp({inviteCode:'r153-editor-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function req(path,cookie='',method='GET',body){
  const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const auth={username:name,email:name+'@example.org',password:'r153-editor-secure-password',inviteCode:'r153-editor-invite'};
  assert.equal((await req('/auth/register','','POST',auth)).status,201);
  const login=await req('/auth/login','','POST',auth);
  return{cookie:login.cookie,world:(await req('/auth/me',login.cookie)).json.worlds[0].id};
 }
 try{
  const author=await account('editorowner153'),other=await account('editorother153');
  const slug='r153-story',path='/series/'+slug;
  assert.equal((await req('/series',author.cookie,'POST',{worldId:author.world,slug,title:'Original'})).status,201);
  assert.equal((await req(path,author.cookie,'PATCH',{title:'Renamed',description:'<svg onload=evil()>',nextAt:null})).status,200);
  assert.equal((await req(path,other.cookie,'PATCH',{title:'Attack'})).status,403);
  assert.equal((await req(path,author.cookie,'PATCH',{title:''})).status,400);
  assert.equal((await req(path,author.cookie,'PATCH',{worldId:other.world})).status,400);
  const page=await fetch(base+path,{headers:{Cookie:author.cookie}}).then(r=>r.text());
  assert.match(page,/id="series-meta"/);assert.doesNotMatch(page,/<svg onload=evil/);
  const ids=[];
  for(let i=0;i<3;i++){
   const post=await req('/posts',author.cookie,'POST',{worldId:author.world,status:'published',body:'Chapter '+i});
   assert.equal(post.status,201);ids.push(post.json.id);
   assert.equal((await req(path+'/episodes',author.cookie,'POST',{postId:post.json.id,title:'Chapter '+i})).status,201);
  }
  const before=(await req(path)).json.episodes;
  assert.deepEqual(before.map(e=>e.position),[1,2,3]);
  const order=[before[2].id,before[0].id,before[1].id];
  assert.equal((await req(path+'/episodes/order',other.cookie,'PUT',{order})).status,403);
  assert.equal((await req(path+'/episodes/order',author.cookie,'PUT',{order:[order[0],order[0],order[1]]})).status,400);
  assert.equal((await req(path+'/episodes/order',author.cookie,'PUT',{order:[order[0],order[1]]})).status,409);
  assert.equal((await req(path+'/episodes/order',author.cookie,'PUT',{order})).status,200);
  assert.deepEqual((await req(path)).json.episodes.map(e=>e.id),order);
  assert.equal((await req(path+'/episodes/'+order[0],author.cookie,'PATCH',{title:'Finale'})).status,200);
  assert.equal((await req(path+'/episodes/'+order[0],other.cookie,'DELETE',{confirm:true})).status,403);
  assert.equal((await req(path+'/episodes/'+order[0],author.cookie,'DELETE',{confirm:false})).status,400);
  assert.equal((await req(path+'/episodes/'+order[0],author.cookie,'DELETE',{confirm:true})).json.postPreserved,true);
  assert.deepEqual((await req(path)).json.episodes.map(e=>e.position),[1,2]);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE id=?').get(ids[2]).n,1);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});

test('R153 emergency content freeze rejects all editorial changes including PUT reordering',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r153-editor-freeze-')),dbPath=join(dir,'lab.sqlite');
 const inviteCode='r153-editor-freeze-invite';
 let app=createApp({databasePath:dbPath,inviteCode});
 let base='';
 async function start(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}
 async function req(path,cookie='',method='GET',body){
  const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  await start();
  const credentials={username:'frozeneditor153',email:'frozeneditor153@example.org',
   password:'long-secure-freeze-password',inviteCode};
  assert.equal((await req('/auth/register','','POST',credentials)).status,201);
  const cookie=(await req('/auth/login','','POST',credentials)).cookie;
  const world=(await req('/auth/me',cookie)).json.worlds[0].id;
  const slug='frozen-editor',path='/series/'+slug;
  assert.equal((await req('/series',cookie,'POST',{worldId:world,slug,title:'Frozen editorial release'})).status,201);
  const order=[];
  for(let i=0;i<2;i++){
   const post=(await req('/posts',cookie,'POST',{worldId:world,body:'Chapter '+i,status:'published'})).json;
   order.push((await req(path+'/episodes',cookie,'POST',{postId:post.id,title:'Chapter '+i})).json.id);
  }
  await app.close();
  app=createApp({databasePath:dbPath,inviteCode,contentWritesDisabled:true});
  await start();
  assert.equal((await req(path+'/episodes/order',cookie,'PUT',{order:[order[1],order[0]]})).status,503);
  assert.equal((await req(path+'/episodes/'+order[0],cookie,'PATCH',{title:'Attack'})).status,503);
  assert.equal((await req(path,cookie,'PATCH',{title:'Attack'})).status,503);
  assert.deepEqual((await req(path,cookie)).json.episodes.map(e=>e.id),order);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
