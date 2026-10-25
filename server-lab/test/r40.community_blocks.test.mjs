import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R40: bilateral block filters real Worlds/posts/comments and severs follows, events and sponsors',async()=>{
 const app=createApp({inviteCode:'r40-blocks-private-invite'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='very-strong-r40-password';
 async function req(path,{method='GET',cookie,json,origin=base}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function account(username){
  const email=username+'@example.org';
  const registered=await req('/auth/register',{method:'POST',json:{username,email,password,inviteCode:'r40-blocks-private-invite'}});
  assert.equal(registered.status,201);
  const signed=await req('/auth/login',{method:'POST',json:{email,password}});
  assert.equal(signed.status,200);
  const cookie=signed.cookie.split(';')[0];
  const info=await req('/auth/me',{cookie});
  assert.equal(info.status,200);
  return{cookie,world:info.data.worlds[0],id:info.data.user.id};
 }
 try{
  const alice=await account('alice40');
  const bob=await account('bob40');
  const carol=await account('carol40');
  const post=async(owner,body)=>req('/posts',{method:'POST',cookie:owner.cookie,json:{worldId:owner.world.id,body,status:'published'}});
  const alicePost=await post(alice,'Alice public story about community care');
  const bobPost=await post(bob,'Bob public story about business');
  assert.equal(alicePost.status,201);assert.equal(bobPost.status,201);
  let x=await req('/worlds/'+alice.world.slug+'/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(x.status,201);
  x=await req('/worlds/'+bob.world.slug+'/follow',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(x.status,201);
  x=await req('/posts/'+alicePost.data.id+'/comments',{cookie:bob.cookie,method:'POST',json:{body:'Bob comment before block'}});
  assert.equal(x.status,201);
  x=await req('/posts/'+bobPost.data.id+'/comments',{cookie:alice.cookie,method:'POST',json:{body:'Alice reply before block'}});
  assert.equal(x.status,201);
  x=await req('/sponsors/proposals',{cookie:bob.cookie,method:'POST',
   json:{worldId:alice.world.id,brandName:'Test Brand',headline:'Manual proof of ad withdrawal',landingUrl:'https://brand.example.org/path'}});
  assert.equal(x.status,201);
  let pending=app.db.prepare("SELECT count(*) AS n FROM activity_events WHERE (recipient_id=? AND actor_id=?) OR (recipient_id=? AND actor_id=?)")
   .get(alice.id,bob.id,bob.id,alice.id).n;
  assert.ok(pending>=2,'real pre-block notifications exist');
  x=await req('/me/blocks');assert.equal(x.status,401);
  x=await req('/users/alice40/block',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(x.status,400);
  x=await req('/users/noone40/block',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(x.status,404);
  x=await req('/users/bob40/block',{cookie:alice.cookie,method:'POST',origin:'https://evil.example.org',json:{}});
  assert.equal(x.status,403);
  x=await req('/users/bob40/block',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(x.status,201);assert.equal(x.data.blocked,true);assert.equal(x.data.changed,true);
  x=await req('/users/bob40/block',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(x.status,200);assert.equal(x.data.changed,false);
  x=await req('/me/blocks',{cookie:alice.cookie});
  assert.equal(x.status,200);assert.deepEqual(x.data.items.map(v=>v.username),['bob40']);
  assert.doesNotMatch(JSON.stringify(x.data),/password|email|user_id|blocker_id/);
  x=await req('/me/blocks',{cookie:bob.cookie});assert.deepEqual(x.data.items,[]);
  const follows=app.db.prepare("SELECT count(*) AS n FROM world_follows WHERE (world_id=? AND user_id=?) OR (world_id=? AND user_id=?)")
   .get(alice.world.id,bob.id,bob.world.id,alice.id).n;
  assert.equal(follows,0,'both directions of follow are removed');
  pending=app.db.prepare("SELECT count(*) AS n FROM activity_events WHERE (recipient_id=? AND actor_id=?) OR (recipient_id=? AND actor_id=?)")
   .get(alice.id,bob.id,bob.id,alice.id).n;
  assert.equal(pending,0,'old notifications removed without informing blocked account');
  x=await req('/me/sponsors',{cookie:bob.cookie});
  assert.equal(x.data.items[0].status,'revoked');
  const view=async(cookie)=>req('/posts',{cookie});
  assert.deepEqual((await view(alice.cookie)).data.items.map(v=>v.username),['alice40']);
  assert.deepEqual((await view(bob.cookie)).data.items.map(v=>v.username),['bob40']);
  const guestPosts=(await view()).data.items.map(v=>v.username);
  assert.ok(guestPosts.includes('alice40')&&guestPosts.includes('bob40'),'anonymous public access remains');
  const carolPosts=(await view(carol.cookie)).data.items.map(v=>v.username);
  assert.ok(carolPosts.includes('alice40')&&carolPosts.includes('bob40'));
  const worlds=async(cookie)=>req('/worlds',{cookie});
  let names=(await worlds(alice.cookie)).data.items.map(w=>w.owner);
  assert.ok(names.includes('alice40')&&!names.includes('bob40'));
  names=(await worlds(bob.cookie)).data.items.map(w=>w.owner);
  assert.ok(names.includes('bob40')&&!names.includes('alice40'));
  names=(await worlds(carol.cookie)).data.items.map(w=>w.owner);
  assert.ok(names.includes('alice40')&&names.includes('bob40'));
  x=await req('/discover?q=Alice',{cookie:bob.cookie});
  assert.equal(x.status,200);assert.equal(x.data.worlds.length,0);assert.equal(x.data.posts.length,0);
  x=await req('/worlds/'+alice.world.slug+'/posts',{cookie:bob.cookie});
  assert.equal(x.status,200);assert.equal(x.data.items.length,0);
  x=await req('/worlds/'+alice.world.slug+'/followers',{cookie:bob.cookie});assert.equal(x.status,404);
  x=await req('/posts/'+alicePost.data.id+'/comments',{cookie:alice.cookie});
  assert.equal(x.status,200);assert.equal(x.data.items.length,0,'blocked commenter hidden from Alice');
  x=await req('/posts/'+alicePost.data.id+'/comments');
  assert.equal(x.data.items.length,1,'guest can see genuinely public historical reply');
  x=await req('/posts/'+alicePost.data.id+'/comments',{cookie:bob.cookie});
  assert.equal(x.status,404,'blocked author post cannot be read by signed-in peer');
  x=await req('/worlds/'+alice.world.slug+'/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(x.status,403);
  x=await req('/worlds/'+bob.world.slug+'/follow',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(x.status,403);
  x=await req('/posts/'+alicePost.data.id+'/comments',{cookie:bob.cookie,method:'POST',json:{body:'Blocked interaction'}});
  assert.equal(x.status,403);
  x=await req('/sponsors/proposals',{cookie:bob.cookie,method:'POST',
   json:{worldId:alice.world.id,brandName:'Blocked Brand',headline:'No ad contract allowed',landingUrl:'https://brand.example.org'}});
  assert.equal(x.status,403);
  const bobActivity=await req('/me/activity',{cookie:bob.cookie});
  assert.ok(bobActivity.data.items.every(e=>e.actor!=='alice40'));
  x=await req('/users/bob40/block',{cookie:alice.cookie,method:'DELETE',json:{}});
  assert.equal(x.status,200);assert.equal(x.data.blocked,false);
  x=await req('/me/blocks',{cookie:alice.cookie});
  assert.equal(x.data.items.length,0);
  names=(await worlds(bob.cookie)).data.items.map(w=>w.owner);
  assert.ok(names.includes('alice40'),'unblock restores visibility without re-creating subscriptions');
  x=await req('/worlds/'+alice.world.slug+'/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(x.status,201);
  x=await req('/users/bob40/block',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(x.status,201);
  x=await req('/account',{cookie:bob.cookie,method:'DELETE',json:{confirm:'DELETE',password}});
  assert.equal(x.status,200);
  x=await req('/me/blocks',{cookie:alice.cookie});
  assert.deepEqual(x.data.items,[],'deleted account cascades owner block references');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
