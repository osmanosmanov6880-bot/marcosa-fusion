import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('reader continuation and reminder dismissal are private, idempotent and usable during freeze',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r151-reader-'));
 const databasePath=join(dir,'lab.sqlite'),inviteCode='r151-reader-local-invite';
 let app=createApp({databasePath,inviteCode});
 let base='';
 async function start(){
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+app.server.address().port;
 }
 async function req(path,{method='GET',cookie='',body,origin=base}={}){
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
   ...(method==='GET'?{}:{body:JSON.stringify(body??{})})});
  return {status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const auth={username:name,email:name+'@example.net',password:'strong-reader-password',inviteCode};
  assert.equal((await req('/auth/register',{method:'POST',body:auth})).status,201);
  const login=await req('/auth/login',{method:'POST',body:auth});
  const world=(await req('/auth/me',{cookie:login.cookie})).json.worlds[0].id;
  return {cookie:login.cookie,world};
 }
 try{
  await start();
  const author=await account('creator151'),reader=await account('reader151'),stranger=await account('other151');
  assert.equal((await req('/series',{method:'POST',cookie:author.cookie,body:{worldId:author.world,slug:'reading-season',title:'Reading Season'}})).status,201);
  assert.equal((await req('/series/reading-season/subscription',{method:'POST',cookie:reader.cookie})).status,200);
  const createEpisode=async title=>{
   const post=await req('/posts',{method:'POST',cookie:author.cookie,body:{worldId:author.world,body:title,status:'published'}});
   const episode=await req('/series/reading-season/episodes',{method:'POST',cookie:author.cookie,body:{postId:post.json.id,title}});
   assert.equal(episode.status,201);
   return episode.json.id;
  };
  const first=await createEpisode('Episode one');
  assert.equal((await req('/me/series-continue')).status,401);
  assert.deepEqual((await req('/me/series-continue',{cookie:stranger.cookie})).json.items,[]);
  let next=(await req('/me/series-continue',{cookie:reader.cookie})).json.items;
  assert.equal(next.length,1);assert.equal(next[0].episodeId,first);
  assert.equal((await req('/series/reading-season/metrics/attendance',{method:'POST',cookie:reader.cookie,body:{episodeId:first,consent:true}})).status,200);
  assert.deepEqual((await req('/me/series-continue',{cookie:reader.cookie})).json.items,[]);
  const second=await createEpisode('Episode two');
  next=(await req('/me/series-continue',{cookie:reader.cookie})).json.items;
  assert.equal(next[0].episodeId,second);
  let inbox=(await req('/me/series-reminders',{cookie:reader.cookie})).json.items;
  assert.equal(inbox.length,2);
  assert.ok(inbox.every(x=>Number.isSafeInteger(x.episodeId)));
  assert.equal((await req('/me/series-reminders/'+first,{method:'DELETE',cookie:stranger.cookie})).status,200);
  assert.equal((await req('/me/series-reminders',{cookie:reader.cookie})).json.items.length,2);
  assert.equal((await req('/me/series-reminders/'+first,{method:'DELETE',cookie:reader.cookie})).status,200);
  assert.equal((await req('/me/series-reminders/'+first,{method:'DELETE',cookie:reader.cookie})).status,200);
  inbox=(await req('/me/series-reminders',{cookie:reader.cookie})).json.items;
  assert.deepEqual(inbox.map(x=>x.episodeId),[second]);
  assert.equal((await req('/me/series-reminders/'+second,{method:'DELETE',cookie:reader.cookie,origin:'https://evil.invalid'})).status,403);
  await app.close();
  app=createApp({databasePath,inviteCode,contentWritesDisabled:true});await start();
  assert.equal((await req('/me/series-reminders/'+second,{method:'DELETE',cookie:reader.cookie})).status,200);
  assert.deepEqual((await req('/me/series-reminders',{cookie:reader.cookie})).json.items,[]);
  assert.equal((await req('/series/reading-season/subscription',{method:'POST',cookie:reader.cookie})).status,503);
  assert.equal((await req('/me/series-continue',{cookie:reader.cookie})).json.items[0].episodeId,second);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
