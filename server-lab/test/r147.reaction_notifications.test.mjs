import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';

test('R147: reactions create private, preference-controlled activity only for a new reaction',async()=>{
 const app=createApp({inviteCode:'r147-reaction-alert-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,password='r147-long-local-password';
 async function req(path,{method='GET',cookie,json}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function member(username){
  let result=await req('/auth/register',{method:'POST',json:{username,email:username+'@example.org',password,inviteCode:'r147-reaction-alert-invite'}});
  assert.equal(result.status,201);result=await req('/auth/login',{method:'POST',json:{email:username+'@example.org',password}});
  assert.equal(result.status,200);const cookie=result.cookie.split(';')[0];result=await req('/auth/me',{cookie});
  return{cookie,world:result.data.worlds[0]};
 }
 try{
  const author=await member('author147'),reader=await member('reader147'),another=await member('another147');
  const post=await req('/posts',{cookie:author.cookie,method:'POST',json:{worldId:author.world.id,status:'published',body:'Story for real activity'}});
  assert.equal(post.status,201);
  let settings=await req('/me/notification-settings',{cookie:author.cookie});
  assert.equal(settings.data.settings.reactions,true,'reaction alerts default on');
  assert.equal((await req('/me/notification-settings',{cookie:author.cookie,method:'PATCH',json:{reactions:false}})).status,200);
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:reader.cookie,method:'POST',json:{reaction:'like'}})).status,201);
  let activity=await req('/me/activity',{cookie:author.cookie});assert.deepEqual(activity.data.items,[],'opt-out suppresses future alert only');
  assert.equal((await req('/me/notification-settings',{cookie:author.cookie,method:'PATCH',json:{reactions:true}})).status,200);
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:another.cookie,method:'POST',json:{reaction:'support'}})).status,201);
  activity=await req('/me/activity',{cookie:author.cookie});
  assert.equal(activity.data.items.length,1);assert.equal(activity.data.items[0].kind,'post_reaction');assert.equal(activity.data.items[0].actor,'another147');
  assert.equal(activity.data.items[0].post_id,post.data.id);assert.equal(activity.data.items[0].world,author.world.slug);
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:another.cookie,method:'POST',json:{reaction:'celebrate'}})).status,200);
  activity=await req('/me/activity',{cookie:author.cookie});assert.equal(activity.data.items.length,1,'changing a reaction does not emit another alert');
  assert.equal((await req('/account/export',{cookie:author.cookie})).data.notificationSettings.reactions,true);
  assert.equal((await req('/me/notification-settings',{cookie:author.cookie,method:'PATCH',json:{reactions:'false'}})).status,400);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});

test('R147: additive event and preference migration preserves legacy data',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'marcosa-r147-migration-')),databasePath=join(directory,'legacy.sqlite');
 let app=createApp({databasePath,inviteCode:'r147-legacy-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 let base='http://127.0.0.1:'+app.server.address().port;const password='r147-legacy-long-password';
 async function req(path,{method='GET',cookie,json}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 try{
  for(const username of ['legacyowner147','legacyactor147']){
   const registered=await req('/auth/register',{method:'POST',json:{username,email:username+'@example.org',password,inviteCode:'r147-legacy-invite'}});assert.equal(registered.status,201);
  }
  const ownerLogin=await req('/auth/login',{method:'POST',json:{email:'legacyowner147@example.org',password}}),actorLogin=await req('/auth/login',{method:'POST',json:{email:'legacyactor147@example.org',password}});
  const ownerCookie=ownerLogin.cookie.split(';')[0],actorCookie=actorLogin.cookie.split(';')[0];
  const owner=(await req('/auth/me',{cookie:ownerCookie})).data,actor=(await req('/auth/me',{cookie:actorCookie})).data;
  const post=await req('/posts',{cookie:ownerCookie,method:'POST',json:{worldId:owner.worlds[0].id,status:'published',body:'Legacy notification target'}});
  await req('/posts/'+post.data.id+'/comments',{cookie:actorCookie,method:'POST',json:{body:'A preserved legacy comment alert'}});
  await app.close();app=null;
  const legacy=new DatabaseSync(databasePath);legacy.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  legacy.exec(`CREATE TABLE activity_events_legacy (id INTEGER PRIMARY KEY AUTOINCREMENT,recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('new_follow','post_comment','sponsor_proposal','sponsor_accepted','sponsor_rejected','sponsor_approved','sponsor_revoked')),world_id TEXT REFERENCES worlds(id) ON DELETE CASCADE,post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,sponsor_id INTEGER REFERENCES sponsor_proposals(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,read_at INTEGER,CHECK(recipient_id<>actor_id));
   INSERT INTO activity_events_legacy SELECT * FROM activity_events; DROP TABLE activity_events; ALTER TABLE activity_events_legacy RENAME TO activity_events;
   CREATE INDEX idx_activity_owner ON activity_events(recipient_id,id DESC); CREATE INDEX idx_activity_unread ON activity_events(recipient_id,id DESC) WHERE read_at IS NULL;
   CREATE TABLE notification_preferences_legacy(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,follows_enabled INTEGER NOT NULL DEFAULT 1 CHECK(follows_enabled IN (0,1)),comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK(comments_enabled IN (0,1)),sponsors_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sponsors_enabled IN (0,1)),updated_at INTEGER NOT NULL);
   INSERT INTO notification_preferences_legacy(user_id,follows_enabled,comments_enabled,sponsors_enabled,updated_at) SELECT user_id,follows_enabled,comments_enabled,sponsors_enabled,updated_at FROM notification_preferences;
   DROP TABLE notification_preferences; ALTER TABLE notification_preferences_legacy RENAME TO notification_preferences; COMMIT;`);
  legacy.close();
  app=createApp({databasePath,inviteCode:'r147-legacy-invite'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+app.server.address().port;
  const migratedOwner=await req('/auth/login',{method:'POST',json:{email:'legacyowner147@example.org',password}});
  const migratedCookie=migratedOwner.cookie.split(';')[0];
  const oldActivity=await req('/me/activity',{cookie:migratedCookie});assert.equal(oldActivity.data.items.length,1);assert.equal(oldActivity.data.items[0].kind,'post_comment');
  assert.equal((await req('/me/notification-settings',{cookie:migratedCookie})).data.settings.reactions,true,'existing accounts receive the additive default');
  const oldPostId=oldActivity.data.items[0].post_id;
  assert.equal((await req('/posts/'+oldPostId+'/reaction',{cookie:actorCookie,method:'POST',json:{reaction:'like'}})).status,201,'new event kind works after upgrading legacy constraint');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{if(app)await app.close();rmSync(directory,{recursive:true,force:true});}
});
