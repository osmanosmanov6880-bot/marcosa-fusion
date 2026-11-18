import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R154 private archive takes down series, continuation, bookmarks and reminders; owner may restore',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'marcosa-r154-archive-')),file=join(temp,'app.sqlite'),inviteCode='r154-archive-invite';
 let app=createApp({databasePath:file,inviteCode}),base='';
 async function listen(){await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));base='http://127.0.0.1:'+app.server.address().port;}
 async function request(path,cookie='',method='GET',body,origin=base){
  const res=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:res.status,json:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 async function member(name){
  const auth={username:name,email:name+'@example.org',password:'archive-safe-password-2026',inviteCode};
  assert.equal((await request('/auth/register','','POST',auth)).status,201);
  const login=await request('/auth/login','','POST',auth);
  return{cookie:login.cookie,world:(await request('/auth/me',login.cookie)).json.worlds[0].id};
 }
 try{
  await listen();
  const author=await member('r154archiveauthor'),reader=await member('r154archivereader');
  const slug='archived-story',path='/series/'+slug;
  assert.equal((await request('/series',author.cookie,'POST',{worldId:author.world,slug,title:'Archived story'})).status,201);
  assert.equal((await request(path+'/subscription',reader.cookie,'POST',{})).status,200);
  async function publish(name){
   const post=await request('/posts',author.cookie,'POST',{worldId:author.world,body:name,status:'published'});
   const episode=await request(path+'/episodes',author.cookie,'POST',{postId:post.json.id,title:name});
   assert.equal(episode.status,201);return episode.json.id;
  }
  const episodeId=await publish('Chapter one');
  assert.equal((await request(path+'/episodes/'+episodeId+'/bookmark',reader.cookie,'POST',{})).status,200);
  assert.equal((await request('/me/series-reminders',reader.cookie)).json.items.length,1);
  assert.equal((await request(path+'/publication',reader.cookie,'DELETE',{})).status,403);
  assert.equal((await request(path+'/publication',author.cookie,'DELETE',{},'https://evil.invalid')).status,403);
  assert.equal((await request(path+'/publication',author.cookie,'DELETE',{})).json.remindersRemoved,1);
  assert.equal((await request(path+'/publication',author.cookie,'DELETE',{})).json.changed,false);
  assert.equal((await request(path,reader.cookie)).status,404);
  assert.equal((await request(path,author.cookie)).status,200);
  assert.deepEqual((await request('/me/series-reminders',reader.cookie)).json.items,[]);
  assert.deepEqual((await request('/me/series-bookmarks',reader.cookie)).json.items,[]);
  assert.deepEqual((await request('/me/series-continue',reader.cookie)).json.items,[]);
  assert.ok(!(await request('/series',reader.cookie)).json.items.some(x=>x.slug===slug));
  assert.equal((await request('/account/export',author.cookie)).json.seasonData.seasons[0].archivedAt>0,true);
  assert.equal((await request(path+'/publication',author.cookie,'POST',{})).json.notificationsBackfilled,false);
  assert.equal((await request(path,reader.cookie)).status,200);
  assert.equal((await request('/me/series-bookmarks',reader.cookie)).json.items.length,1);
  assert.equal((await request('/me/series-reminders',reader.cookie)).json.items.length,0);
  const episode2=await publish('Chapter two');
  assert.equal((await request('/me/series-reminders',reader.cookie)).json.items[0].episodeId,episode2);
  await app.close();app=createApp({databasePath:file,inviteCode,contentWritesDisabled:true});await listen();
  assert.equal((await request(path+'/publication',author.cookie,'DELETE',{})).status,200);
  assert.equal((await request(path+'/publication',author.cookie,'POST',{})).status,503);
  assert.equal((await request(path,reader.cookie)).status,404);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();rmSync(temp,{recursive:true,force:true});}
});

test('R154 archived_at migration upgrades legacy SQLite without breaking existing season rows',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r154-legacy-')),file=join(dir,'a.sqlite');
 let app=createApp({databasePath:file});
 try{
  await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
  app.db.exec('ALTER TABLE series DROP COLUMN archived_at');
  await app.close();app=null;
  app=createApp({databasePath:file});
  await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
  assert.ok(app.db.prepare('PRAGMA table_info(series)').all().some(x=>x.name==='archived_at'));
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
