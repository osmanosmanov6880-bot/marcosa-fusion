import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R50: private server-enforced notification preferences, event filtering, persistence and deletion',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'marcosa-r50-'));
 const databasePath=join(directory,'local.sqlite');
 const invite='r50-local-long-enough-invite';
 const password='r50-strong-password-2026';
 let server=null,base='';
 async function start(){
  server=createApp({databasePath,inviteCode:invite});
  await new Promise(done=>server.server.listen(0,'127.0.0.1',done));
  base='http://127.0.0.1:'+server.server.address().port;
 }
 async function req(path,{method='GET',cookie,json,origin=base}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const r=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 async function member(username){
  const email=username+'@example.net';
  const reg=await req('/auth/register',{method:'POST',json:{username,email,password,inviteCode:invite}});
  assert.equal(reg.status,201);
  const login=await req('/auth/login',{method:'POST',json:{email,password}});
  assert.equal(login.status,200);
  const cookie=login.cookie.split(';')[0];
  const me=await req('/auth/me',{cookie});
  assert.equal(me.status,200);
  return{cookie,world:me.data.worlds[0],id:me.data.user.id,username};
 }
 try{
  await start();
  const alice=await member('alice50'),bob=await member('bob50'),carol=await member('carol50');
  let r=await req('/me/notification-settings');
  assert.equal(r.status,401);
  r=await req('/me/notification-settings',{cookie:alice.cookie});
  assert.equal(r.status,200);
  assert.deepEqual({f:r.data.settings.follows,c:r.data.settings.comments,s:r.data.settings.sponsorships},{f:true,c:true,s:true});
  assert.equal(r.data.settings.updatedAt,null);
  assert.equal(r.data.email,false);assert.equal(r.data.push,false);
  const story=await req('/posts',{cookie:alice.cookie,method:'POST',json:{worldId:alice.world.id,status:'published',body:'Verified creator story for opt-out events'}});
  assert.equal(story.status,201);
  r=await req('/worlds/'+alice.world.slug+'/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(r.status,201);
  const initial=await req('/me/activity',{cookie:alice.cookie});
  assert.deepEqual(initial.data.items.map(x=>x.kind),['new_follow']);
  const bad=[
   {follows:1},{comments:'false'},{sponsorships:null},{email:true},{actor:'bob50',comments:false},{}
  ];
  for(const payload of bad){
   r=await req('/me/notification-settings',{cookie:alice.cookie,method:'PATCH',json:payload});
   assert.equal(r.status,400,JSON.stringify(payload));
  }
  r=await req('/me/notification-settings',{cookie:alice.cookie,method:'PATCH',
   origin:'https://attacker.example.net',json:{follows:false}});
  assert.equal(r.status,403);
  r=await req('/me/notification-settings',{method:'PATCH',json:{comments:false}});
  assert.equal(r.status,401);
  r=await req('/me/notification-settings',{cookie:alice.cookie,method:'PATCH',
   json:{follows:false,comments:false,sponsorships:false}});
  assert.equal(r.status,200);
  assert.deepEqual({f:r.data.settings.follows,c:r.data.settings.comments,s:r.data.settings.sponsorships},{f:false,c:false,s:false});
  assert.ok(Number.isFinite(r.data.settings.updatedAt));
  r=await req('/worlds/'+alice.world.slug+'/follow',{cookie:carol.cookie,method:'POST',json:{}});
  assert.equal(r.status,201,'social relation still works with alerts muted');
  r=await req('/posts/'+story.data.id+'/comments',{cookie:bob.cookie,method:'POST',json:{body:'Useful story, thanks Alice'}});
  assert.equal(r.status,201,'reply still writes when notification suppressed');
  r=await req('/sponsors/proposals',{cookie:carol.cookie,method:'POST',json:{
   worldId:alice.world.id,brandName:'Real Pilot Studio',headline:'A trial proposal without payments',
   landingUrl:'https://studio.example.org/pilot'}});
  assert.equal(r.status,201,'sponsor proposal still recorded but no new alert');
  r=await req('/me/activity',{cookie:alice.cookie});
  assert.deepEqual(r.data.items.map(x=>x.kind),['new_follow'],'historical event preserved and new events suppressed');
  const bobSettings=await req('/me/notification-settings',{cookie:bob.cookie});
  assert.equal(bobSettings.data.settings.follows,true,'other account unchanged');
  r=await req('/me/notification-settings',{cookie:alice.cookie,method:'PATCH',json:{comments:true}});
  assert.equal(r.status,200);
  assert.equal(r.data.settings.comments,true);
  assert.equal(r.data.settings.follows,false);
  assert.equal(r.data.settings.sponsorships,false);
  r=await req('/posts/'+story.data.id+'/comments',{cookie:carol.cookie,method:'POST',json:{body:'A new real reply, expected alert'}});
  assert.equal(r.status,201);
  r=await req('/me/activity',{cookie:alice.cookie});
  assert.deepEqual(r.data.items.map(x=>x.kind),['post_comment','new_follow']);
  r=await req('/me/notification-settings',{cookie:alice.cookie,method:'PATCH',json:{sponsorships:true}});
  assert.equal(r.status,200);
  const ad=await req('/sponsors/proposals',{cookie:bob.cookie,method:'POST',json:{
   worldId:alice.world.id,brandName:'Another Real Studio',headline:'Invited sponsorship pilot pending approval',
   landingUrl:'https://brand.example.com/info'}});
  assert.equal(ad.status,201);
  r=await req('/me/activity',{cookie:alice.cookie});
  assert.deepEqual(r.data.items.map(x=>x.kind),['sponsor_proposal','post_comment','new_follow']);
  const x=await req('/account/export',{cookie:alice.cookie});
  assert.equal(x.status,200);
  assert.equal(x.data.notificationSettings.comments,true);
  assert.equal(x.data.notificationSettings.follows,false);
  assert.equal(x.data.notificationSettings.sponsorships,true);
  assert.doesNotMatch(JSON.stringify(x.data),/password_hash|token_hash|private_key/);
  const settingsSql=server.db.prepare('SELECT count(*) AS n FROM notification_preferences').get();
  assert.equal(settingsSql.n,1);
  assert.deepEqual(server.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await server.close();server=null;
  await start();
  const second=await req('/auth/login',{method:'POST',json:{email:'alice50@example.net',password}});
  assert.equal(second.status,200);
  const cookie2=second.cookie.split(';')[0];
  const persisted=await req('/me/notification-settings',{cookie:cookie2});
  assert.equal(persisted.status,200);
  assert.equal(persisted.data.settings.follows,false);
  assert.equal(persisted.data.settings.comments,true);
  assert.equal(persisted.data.settings.sponsorships,true);
  const del=await req('/account',{cookie:cookie2,method:'DELETE',json:{confirm:'DELETE',password}});
  assert.equal(del.status,200);
  assert.equal(server.db.prepare('SELECT count(*) AS n FROM notification_preferences').get().n,0,
   'SQL FK cascade deletes personal preferences with account');
  assert.deepEqual(server.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{if(server)await server.close();rmSync(directory,{recursive:true,force:true});}
});
