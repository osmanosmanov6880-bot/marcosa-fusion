import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R153 reminders paginate with no overlap, clear only actor records and survive incident freeze',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r153-reminders-')),file=join(dir,'lab.sqlite');
 let app=createApp({databasePath:file,inviteCode:'r153-inbox-invite'});
 let base='';
 async function start(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}
 async function req(path,cookie='',method='GET',body,origin=base){
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const auth={username:name,email:name+'@example.org',password:'r153-inbox-password-2026',inviteCode:'r153-inbox-invite'};
  assert.equal((await req('/auth/register','','POST',auth)).status,201);
  const login=await req('/auth/login','','POST',auth);
  return{cookie:login.cookie,world:(await req('/auth/me',login.cookie)).json.worlds[0].id};
 }
 try{
  await start();
  const author=await account('inboxauthor153'),reader=await account('inboxreader153'),other=await account('inboxother153');
  const series='/series/reminder-season';
  assert.equal((await req('/series',author.cookie,'POST',{worldId:author.world,slug:'reminder-season',title:'Reminder season'})).status,201);
  for(const user of [reader,other])assert.equal((await req(series+'/subscription',user.cookie,'POST',{})).status,200);
  for(let i=0;i<23;i++){
   const post=await req('/posts',author.cookie,'POST',{worldId:author.world,status:'published',body:'Part '+i});
   assert.equal(post.status,201);
   assert.equal((await req(series+'/episodes',author.cookie,'POST',{postId:post.json.id,title:'Part '+i})).status,201);
  }
  assert.equal((await req('/me/series-reminders',reader.cookie)).json.items.length,20);
  for(const url of ['/me/series-reminders?cursor=0','/me/series-reminders?limit=51','/me/series-reminders?cursor=1%20OR%201=1'])
   assert.equal((await req(url,reader.cookie)).status,400,url);
  const all=[];let cursor=null;
  do{
   const page=await req('/me/series-reminders?limit=7'+(cursor?'&cursor='+cursor:''),reader.cookie);
   assert.equal(page.status,200);
   all.push(...page.json.items.map(x=>x.episodeId));
   cursor=page.json.nextCursor;
  }while(cursor);
  assert.equal(all.length,23);
  assert.equal(new Set(all).size,23);
  assert.equal((await req('/me/series-reminders',reader.cookie,'DELETE',{unknown:1})).status,400);
  assert.equal((await req('/me/series-reminders',reader.cookie,'DELETE',{},'https://attacker.invalid')).status,403);
  assert.equal((await req('/me/series-reminders',reader.cookie,'DELETE',{})).json.removed,23);
  assert.equal((await req('/me/series-reminders',reader.cookie,'DELETE',{})).json.removed,0);
  assert.equal((await req('/me/series-reminders',other.cookie)).json.items.length,20);
  await app.close();app=createApp({databasePath:file,inviteCode:'r153-inbox-invite',contentWritesDisabled:true});await start();
  assert.equal((await req('/me/series-reminders',other.cookie,'DELETE',{})).json.removed,23);
  assert.equal((await req(series+'/subscription',other.cookie,'POST',{})).status,503);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM series_reminders').get().n,0);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
