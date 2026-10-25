import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R52: topic filtering, ownership, blocked users and public search',async()=>{
 const app=createApp({inviteCode:'r52-private-local-invite'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='r52-long-safe-local-password';
 async function req(path,{method='GET',cookie,json}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const r=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 async function member(username){
  const email=username+'@example.net';
  let r=await req('/auth/register',{method:'POST',json:{username,email,password,inviteCode:'r52-private-local-invite'}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',json:{email,password}});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  r=await req('/auth/me',{cookie});
  return {cookie,world:r.data.worlds[0]};
 }
 try{
  let r=await req('/world-topics');
  assert.equal(r.status,200);
  assert.deepEqual(r.data.items.map(x=>x.id),['general','art','technology','business','education','lifestyle','travel']);
  const alice=await member('alice52'),bob=await member('bob52');
  assert.equal(alice.world.category,'general');
  r=await req('/worlds/'+alice.world.slug,{cookie:alice.cookie,method:'PATCH',json:{title:'City technology studio',description:'City technology news',category:'technology'}});
  assert.equal(r.status,200);assert.equal(r.data.category,'technology');
  const travel=await req('/worlds',{cookie:bob.cookie,method:'POST',json:{title:'City travel journal',slug:'travel-journal-52',description:'City walks and places',category:'travel'}});
  assert.equal(travel.status,201);
  for(const value of ['invalid',true,'',null]){
   r=await req('/worlds/'+alice.world.slug,{cookie:alice.cookie,method:'PATCH',json:{category:value}});
   assert.equal(r.status,400);
  }
  r=await req('/worlds/'+alice.world.slug,{cookie:bob.cookie,method:'PATCH',json:{category:'business'}});
  assert.equal(r.status,404);
  r=await req('/worlds/'+alice.world.slug,{cookie:alice.cookie,method:'PATCH',json:{owner_id:'other',category:'business'}});
  assert.equal(r.status,400);
  const storyA=await req('/posts',{cookie:alice.cookie,method:'POST',json:{worldId:alice.world.id,status:'published',body:'City technology story'}});
  const storyB=await req('/posts',{cookie:bob.cookie,method:'POST',json:{worldId:travel.data.id,status:'published',body:'City travel story'}});
  assert.equal(storyA.status,201);assert.equal(storyB.status,201);
  for(const [category,owner,postId] of [['technology','alice52',storyA.data.id],['travel','bob52',storyB.data.id]]){
   r=await req('/discover?q=city&category='+category);
   assert.equal(r.status,200);
   assert.deepEqual(r.data.worlds.map(x=>x.owner),[owner]);
   assert.deepEqual(r.data.posts.map(x=>x.id),[postId]);
  }
  r=await req('/worlds?category=travel');
  assert.equal(r.status,200);assert.deepEqual(r.data.items.map(x=>x.slug),[travel.data.slug]);
  r=await req('/worlds?category=invalid');assert.equal(r.status,400);
  r=await req('/discover?q=city&category=invalid');assert.equal(r.status,400);
  r=await req('/discover?q=city');
  assert.equal(r.data.worlds.length,2);assert.equal(r.data.posts.length,2);
  r=await req('/users/bob52/block',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(r.status,201);
  r=await req('/discover?q=city&category=travel',{cookie:alice.cookie});
  assert.equal(r.data.worlds.length,0);assert.equal(r.data.posts.length,0);
  assert.ok(app.db.prepare("SELECT name FROM sqlite_master WHERE name='idx_worlds_category'").get());
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
