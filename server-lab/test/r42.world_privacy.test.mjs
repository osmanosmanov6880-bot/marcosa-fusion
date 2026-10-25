import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R42: legacy on-disk World records migrate without losing original data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r42-'));
 const path=join(dir,'legacy.sqlite');
 try{
  const old=new DatabaseSync(path);
  old.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,username TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',created_at INTEGER NOT NULL);");
  old.exec("CREATE TABLE worlds(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL);");
  old.prepare("INSERT INTO users(id,email,username,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)")
   .run('legacy-id','old@example.org','legacy42','legacy-salt','legacy-hash',1);
  old.prepare("INSERT INTO worlds(id,owner_id,slug,title,description,created_at) VALUES(?,?,?,?,?,?)")
   .run('legacy-world','legacy-id','u-legacy42','Original world','Preserved description',1);
  old.close();
  const app=createApp({databasePath:path});
  const original=app.db.prepare('SELECT id,owner_id,slug,title,description,visibility FROM worlds').get();
  assert.equal(original.id,'legacy-world');assert.equal(original.visibility,'public');
  assert.equal(original.description,'Preserved description');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
  app.db.close();
  const reopen=createApp({databasePath:path});
  assert.equal(reopen.db.prepare('SELECT visibility FROM worlds').get().visibility,'public');
  reopen.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('R42: a private World disappears for nonowners in every public endpoint and revokes consent',async()=>{
 const app=createApp({inviteCode:'r42-private-privacy-invite'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='complex-local-password-r42';
 async function req(path,{method='GET',cookie,json,origin=base}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function account(username){
  const email=username+'@example.net';
  let r=await req('/auth/register',{method:'POST',json:{username,email,password,inviteCode:'r42-private-privacy-invite'}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',json:{email,password}});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  r=await req('/auth/me',{cookie});assert.equal(r.status,200);
  return {cookie,world:r.data.worlds[0],id:r.data.user.id};
 }
 try{
  const alice=await account('alice42'),bob=await account('bob42'),carol=await account('carol42');
  let r=await req('/posts',{cookie:alice.cookie,method:'POST',json:{worldId:alice.world.id,status:'published',body:'Alice original public World article'}});
  assert.equal(r.status,201);const article=r.data.id;
  r=await req('/posts',{cookie:bob.cookie,method:'POST',json:{worldId:bob.world.id,status:'published',body:'Bob public reference article'}});
  assert.equal(r.status,201);
  r=await req('/posts/'+article+'/comments',{cookie:bob.cookie,method:'POST',json:{body:'Original public feedback'}});
  assert.equal(r.status,201);const comment=r.data.id;
  r=await req('/worlds/'+alice.world.slug+'/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(r.status,201);
  r=await req('/sponsors/proposals',{cookie:bob.cookie,method:'POST',json:{
   worldId:alice.world.id,brandName:'Privacy Pilot',headline:'Test partner request only',landingUrl:'https://example.org/privacy-pilot'
  }});
  assert.equal(r.status,201);
  assert.ok((await req('/posts')).data.items.some(x=>x.id===article));
  const url='/worlds/'+alice.world.slug;
  r=await req(url,{cookie:bob.cookie,method:'PATCH',json:{visibility:'private'}});
  assert.equal(r.status,404);
  r=await req(url,{cookie:alice.cookie,method:'PATCH',json:{visibility:'visible-to-all'}});
  assert.equal(r.status,400);
  r=await req(url,{cookie:alice.cookie,method:'PATCH',origin:'https://wrong-origin.example',json:{visibility:'private'}});
  assert.equal(r.status,403);
  r=await req(url,{cookie:alice.cookie,method:'PATCH',json:{visibility:'private'}});
  assert.equal(r.status,200);assert.equal(r.data.visibility,'private');
  assert.equal(r.data.visibilityChanged,true);
  const row=app.db.prepare('SELECT visibility FROM worlds WHERE slug=?').get(alice.world.slug);
  assert.equal(row.visibility,'private');
  const follows=app.db.prepare('SELECT count(*) AS n FROM world_follows WHERE world_id=?').get(alice.world.id).n;
  assert.equal(follows,0,'switch removes all former subscribers');
  r=await req('/me/sponsors',{cookie:bob.cookie});
  assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].status,'revoked');
  const counts=app.db.prepare("SELECT count(*) AS n FROM sponsor_proposals WHERE world_id=? AND status IN ('pending_creator','pending_review','approved')").get(alice.world.id);
  assert.equal(counts.n,0);
  const guest=await req('/worlds');
  assert.equal(guest.status,200);
  assert.ok(!guest.data.items.some(x=>x.slug===alice.world.slug),'private World missing for anonymous');
  const privateToAlice=await req('/worlds',{cookie:alice.cookie});
  assert.ok(privateToAlice.data.items.some(x=>x.slug===alice.world.slug&&x.visibility==='private'),'owner still sees own private World');
  const bobCatalogue=await req('/worlds',{cookie:bob.cookie});
  assert.ok(!bobCatalogue.data.items.some(x=>x.slug===alice.world.slug));
  r=await req('/posts');
  assert.ok(!r.data.items.some(x=>x.id===article));
  r=await req('/posts',{cookie:alice.cookie});
  assert.ok(!r.data.items.some(x=>x.id===article),'global feed stays public only even to creator');
  r=await req('/feed/following',{cookie:bob.cookie});
  assert.equal(r.status,200);
  assert.ok(!r.data.items.some(x=>x.id===article));
  r=await req('/discover?q=Alice');
  assert.equal(r.status,200);
  assert.ok(!r.data.worlds.some(x=>x.slug===alice.world.slug));
  assert.ok(!r.data.posts.some(x=>x.id===article));
  r=await req(url+'/posts');
  assert.equal(r.status,404);
  r=await req(url+'/posts',{cookie:bob.cookie});
  assert.equal(r.status,404);
  r=await req(url+'/posts',{cookie:alice.cookie});
  assert.equal(r.status,200);assert.equal(r.data.items[0].id,article);
  r=await req(url+'/followers',{cookie:bob.cookie});assert.equal(r.status,404);
  r=await req(url+'/followers',{cookie:alice.cookie});assert.equal(r.status,200);assert.equal(r.data.count,0);
  r=await req('/posts/'+article+'/comments');assert.equal(r.status,404);
  r=await req('/posts/'+article+'/comments',{cookie:bob.cookie});assert.equal(r.status,404);
  r=await req('/posts/'+article+'/comments',{cookie:alice.cookie});
  assert.equal(r.status,200);assert.equal(r.data.items[0].id,comment);
  r=await req('/posts/'+article+'/comments',{cookie:bob.cookie,method:'POST',json:{body:'Private post guessed by ID'}});
  assert.equal(r.status,404);
  r=await req(url+'/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(r.status,404);
  r=await req('/sponsors/proposals',{cookie:bob.cookie,method:'POST',json:{
   worldId:alice.world.id,brandName:'Private Brand',headline:'Must never reach private World',landingUrl:'https://example.org/restricted'
  }});
  assert.equal(r.status,404);
  r=await req('/reports',{cookie:bob.cookie,method:'POST',json:{postId:article,reason:'other',detail:'Known post ID'}});
  assert.equal(r.status,404);
  r=await req('/comments/'+comment+'/report',{cookie:carol.cookie,method:'POST',json:{reason:'other'}});
  assert.equal(r.status,404);
  r=await req(url,{cookie:alice.cookie,method:'PATCH',json:{visibility:'public'}});
  assert.equal(r.status,200);assert.equal(r.data.visibility,'public');
  r=await req('/posts');
  assert.ok(r.data.items.some(x=>x.id===article));
  r=await req(url+'/followers');assert.equal(r.status,200);assert.equal(r.data.count,0);
  r=await req('/me/sponsors',{cookie:bob.cookie});assert.equal(r.data.items[0].status,'revoked');
  r=await req(url+'/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(r.status,201,'former follower must opt in again');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
