import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

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
