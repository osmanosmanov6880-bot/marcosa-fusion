import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R38: real World presentation edits belong only to the verified owner',async()=>{
 const app=createApp({inviteCode:'r38-lab-invite-is-long-enough'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='r38-local-strong-password';
 async function req(path,{method='GET',cookie,json,origin}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers['Content-Type']='application/json';headers.Origin=origin||base;}
  const r=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 async function account(name){
  let r=await req('/auth/register',{method:'POST',json:{username:name,email:name+'@example.net',password,inviteCode:'r38-lab-invite-is-long-enough'}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',json:{email:name+'@example.net',password}});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  const me=await req('/auth/me',{cookie});
  assert.equal(me.status,200);
  return {cookie,world:me.data.worlds[0]};
 }
 try{
  const alice=await account('alice38'),bob=await account('bob38');
  let result=await req('/posts',{method:'POST',cookie:alice.cookie,json:{worldId:alice.world.id,status:'published',body:'First work in a stable World'}});
  assert.equal(result.status,201);
  const originalPost=result.data.id;
  const path='/worlds/'+alice.world.slug;
  result=await req(path,{method:'PATCH',json:{title:'New Title'}});
  assert.equal(result.status,401);
  result=await req(path,{method:'PATCH',cookie:bob.cookie,json:{title:'Stolen Owner World'}});
  assert.equal(result.status,404);
  result=await req(path,{method:'PATCH',cookie:alice.cookie,origin:'https://attacker.example',json:{title:'Cross-site Attack'}});
  assert.equal(result.status,403);
  for(const invalid of [{slug:'stolen'},{ownerId:bob.world.id},{title:''},{title:'x'.repeat(71)},{description:'x'.repeat(401)},{title:'Safe',role:'admin'},{}]){
   result=await req(path,{method:'PATCH',cookie:alice.cookie,json:invalid});
   assert.equal(result.status,400,'reject field '+JSON.stringify(invalid).slice(0,60));
  }
  const newTitle='The Atelier of Real Stories';
  result=await req(path,{method:'PATCH',cookie:alice.cookie,json:{title:newTitle,description:'Evidence-backed studio and public work'}});
  assert.equal(result.status,200);
  assert.equal(result.data.slug,alice.world.slug);
  assert.equal(result.data.ownerEditable,true);
  result=await req('/worlds');
  const mine=result.data.items.find(x=>x.slug===alice.world.slug);
  assert.equal(mine.title,newTitle);assert.equal(mine.description,'Evidence-backed studio and public work');
  result=await req('/discover?q=Evidence-backed');
  assert.equal(result.status,200);assert.equal(result.data.worlds.length,1);
  result=await req('/worlds/'+alice.world.slug+'/posts');
  assert.equal(result.status,200);assert.equal(result.data.items[0].id,originalPost);
  assert.equal(result.data.items[0].body,'First work in a stable World');
  result=await req(path,{method:'PATCH',cookie:alice.cookie,json:{description:'Updated description only'}});
  assert.equal(result.status,200);assert.equal(result.data.title,newTitle);
  const self=await req('/auth/me',{cookie:alice.cookie});
  assert.equal(self.data.worlds[0].title,newTitle);
  assert.equal(self.data.worlds[0].description,'Updated description only');
  const bobWorld=await req('/auth/me',{cookie:bob.cookie});
  assert.notEqual(bobWorld.data.worlds[0].title,newTitle);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
