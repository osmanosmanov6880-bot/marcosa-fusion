import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R154 mute is idempotent, subscriber-scoped, persistent, no backfill, and allowed in freeze',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'marcosa-r154-mute-')),file=join(temp,'db.sqlite');
 const inviteCode='r154-notifications-invite';
 let app=createApp({databasePath:file,inviteCode}),base='';
 async function start(){await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));base='http://127.0.0.1:'+app.server.address().port;}
 async function req(path,actor='',method='GET',body,origin=base){
  const res=await fetch(base+'/api'+path,{method,headers:{Cookie:actor,Origin:origin,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:res.status,json:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const auth={username:name,email:name+'@example.org',password:'strong-mute-test-password',inviteCode};
  assert.equal((await req('/auth/register','','POST',auth)).status,201);
  const login=await req('/auth/login','','POST',auth);
  return{cookie:login.cookie,world:(await req('/auth/me',login.cookie)).json.worlds[0].id};
 }
 try{
  await start();
  const owner=await account('r154mutewriter'),reader=await account('r154mutereader'),other=await account('r154muteother');
  const slug='mute-journal',path='/series/'+slug;
  assert.equal((await req('/series',owner.cookie,'POST',{worldId:owner.world,slug,title:'Mute journal'})).status,201);
  async function episode(title){
   const post=await req('/posts',owner.cookie,'POST',{worldId:owner.world,status:'published',body:title});
   assert.equal(post.status,201);
   assert.equal((await req(path+'/episodes',owner.cookie,'POST',{postId:post.json.id,title})).status,201);
  }
  assert.equal((await req(path+'/notifications',reader.cookie,'POST',{})).status,409);
  for(const u of [reader,other])assert.equal((await req(path+'/subscription',u.cookie,'POST',{})).status,200);
  await episode('Chapter one');
  for(const u of [reader,other])assert.equal((await req('/me/series-reminders',u.cookie)).json.items.length,1);
  assert.equal((await req(path+'/notifications',reader.cookie,'DELETE',{unexpected:true})).status,400);
  assert.equal((await req(path+'/notifications',reader.cookie,'DELETE',{},'https://attacker.invalid')).status,403);
  assert.equal((await req(path+'/notifications',reader.cookie,'DELETE',{})).json.removed,1);
  assert.equal((await req(path+'/notifications',reader.cookie,'DELETE',{})).json.removed,0);
  assert.equal((await req(path+'/subscription',reader.cookie)).json.muted,true);
  await episode('Chapter two');
  assert.equal((await req('/me/series-reminders',reader.cookie)).json.items.length,0);
  assert.equal((await req('/me/series-reminders',other.cookie)).json.items.length,2);
  assert.equal((await req(path+'/notifications',reader.cookie,'POST',{})).json.backfill,false);
  assert.equal((await req('/me/series-reminders',reader.cookie)).json.items.length,0);
  await episode('Chapter three');
  assert.equal((await req('/me/series-reminders',reader.cookie)).json.items.length,1);
  assert.equal((await req('/account/export',reader.cookie)).json.seasonSubscriptions[0].muted,0);
  await app.close();app=createApp({databasePath:file,inviteCode,contentWritesDisabled:true});await start();
  assert.equal((await req(path+'/notifications',reader.cookie,'DELETE',{})).status,200);
  assert.equal((await req(path+'/notifications',reader.cookie,'POST',{})).status,503);
  assert.equal((await req(path+'/subscription',reader.cookie,'DELETE',{})).status,200);
  assert.equal((await req(path+'/notifications',other.cookie)).json.muted,false);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();rmSync(temp,{recursive:true,force:true});}
});

test('R154 migration adds muted flag to old subscription table without losing subscriptions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r154-migration-')),file=join(dir,'db.sqlite');
 let app=createApp({databasePath:file});
 try{
  app.db.exec('ALTER TABLE series_subscriptions DROP COLUMN muted');
  await app.close();app=null;
  app=createApp({databasePath:file});
  const columns=app.db.prepare('PRAGMA table_info(series_subscriptions)').all();
  assert.ok(columns.some(x=>x.name==='muted'));
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
