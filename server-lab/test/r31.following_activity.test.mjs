import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R31: genuine follow feed, private activity, deletion and unread owner guard',async()=>{
 const app=createApp({inviteCode:'r31-private-lab-invite-code'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='private-password-r31-test';
 async function req(path,session=null,method='GET',body){
  const headers={};
  if(session)headers.Cookie=session;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const res=await fetch(base+'/api'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
 }
 async function account(name){
  let r=await req('/auth/register',null,'POST',{email:name+'@example.org',username:name,password,inviteCode:'r31-private-lab-invite-code'});
  assert.equal(r.status,201);
  r=await req('/auth/login',null,'POST',{email:name+'@example.org',password});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  const info=await req('/auth/me',cookie);
  return {cookie,id:info.data.user.id,world:info.data.worlds[0]};
 }
 try{
  const alice=await account('alice31');
  const bob=await account('bob31');
  const carol=await account('carol31');
  let r=await req('/feed/following');assert.equal(r.status,401);
  r=await req('/me/activity');assert.equal(r.status,401);
  r=await req('/feed/following',bob.cookie);assert.equal(r.status,200);assert.deepEqual(r.data.items,[]);
  const p=await req('/posts',alice.cookie,'POST',{worldId:alice.world.id,body:'Published original article',status:'published'});
  assert.equal(p.status,201);
  await req('/posts',alice.cookie,'POST',{worldId:alice.world.id,body:'Private draft secret',status:'draft'});
  r=await req('/feed/following',bob.cookie);assert.deepEqual(r.data.items,[]);
  r=await req('/worlds/'+alice.world.slug+'/follow',bob.cookie,'POST',{});
  assert.equal(r.status,201);
  r=await req('/feed/following',bob.cookie);assert.equal(r.status,200);
  assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].body,'Published original article');
  r=await req('/me/activity',alice.cookie);assert.equal(r.data.unreadCount,1);
  assert.equal(r.data.items[0].kind,'new_follow');assert.equal(r.data.items[0].actor,'bob31');
  assert.equal(r.data.items[0].read_at,null);
  r=await req('/me/activity',carol.cookie);assert.equal(r.data.items.length,0);
  r=await req('/me/activity/read',carol.cookie,'POST',{});assert.equal(r.data.read,0);
  r=await req('/me/activity/read',alice.cookie,'POST',{});assert.equal(r.data.read,1);
  r=await req('/me/activity',alice.cookie);assert.equal(r.data.unreadCount,0);
  r=await req('/posts/'+p.data.id+'/comments',carol.cookie,'POST',{body:'Interesting work'});
  assert.equal(r.status,201);
  r=await req('/me/activity',alice.cookie);assert.equal(r.data.unreadCount,1);
  assert.equal(r.data.items[0].kind,'post_comment');
  assert.equal(r.data.items[0].actor,'carol31');
  assert.ok(!JSON.stringify(r.data).includes('private-password-r31-test'));
  const exported=await req('/account/export',alice.cookie);
  assert.equal(exported.data.activity.length,2);
  assert.equal(exported.data.activity[0].kind,'new_follow');
  r=await req('/feed/following?limit=0',bob.cookie);assert.equal(r.status,400);
  r=await req('/me/activity?cursor=evil',alice.cookie);assert.equal(r.status,400);
  r=await req('/worlds/'+alice.world.slug+'/follow',bob.cookie,'POST',{});
  assert.equal(r.status,200);
  r=await req('/me/activity',alice.cookie);assert.equal(r.data.items.length,2);
  r=await req('/worlds/'+alice.world.slug+'/follow',bob.cookie,'DELETE',{});
  assert.equal(r.status,200);
  r=await req('/feed/following',bob.cookie);assert.equal(r.data.items.length,0);
  r=await req('/account',alice.cookie,'DELETE',{confirm:'DELETE',password});
  assert.equal(r.status,200);
  r=await req('/me/activity',bob.cookie);assert.equal(r.data.items.length,0);
  r=await req('/me/activity',carol.cookie);assert.equal(r.data.items.length,0);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally {await app.close();}
});
