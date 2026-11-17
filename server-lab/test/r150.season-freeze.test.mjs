import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.mjs';

test('season privacy controls remain available in content freeze',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'marcosa-freeze-season-'));
 const databasePath=join(directory,'lab.sqlite'),inviteCode='season-freeze-invite',password='season-freeze-password';
 let app=createApp({databasePath,inviteCode});
 async function start(){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));}
 async function req(path,{method='GET',cookie,body,origin}={}){
  const base='http://127.0.0.1:'+app.server.address().port,headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin||base;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(method==='GET'?{}:{body:JSON.stringify(body||{})})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  assert.equal((await req('/auth/register',{method:'POST',body:{username:name,email:name+'@example.org',password,inviteCode}})).status,201);
  const login=await req('/auth/login',{method:'POST',body:{email:name+'@example.org',password}});
  return login.cookie;
 }
 try{
  await start();
  const author=await account('freezeauthor150'),reader=await account('freezereader150');
  const me=await req('/auth/me',{cookie:author});
  assert.equal((await req('/series',{method:'POST',cookie:author,body:{slug:'freeze-season',title:'Season',worldId:me.data.worlds[0].id}})).status,201);
  const post=await req('/posts',{method:'POST',cookie:author,body:{worldId:me.data.worlds[0].id,status:'published',body:'A published story'}});
  const episode=await req('/series/freeze-season/episodes',{method:'POST',cookie:author,body:{postId:post.data.id,title:'Episode'}});
  assert.equal((await req('/series/freeze-season/subscription',{method:'POST',cookie:reader})).status,200);
  assert.equal((await req('/series/freeze-season/metrics/attendance',{method:'POST',cookie:reader,body:{episodeId:episode.data.id,consent:true}})).status,200);
  await app.close();app=createApp({databasePath,inviteCode,contentWritesDisabled:true});await start();
  assert.equal((await req('/series/freeze-season/subscription',{method:'POST',cookie:reader})).status,503);
  assert.equal((await req('/series/freeze-season/metrics/attendance',{method:'DELETE',cookie:reader,origin:'https://attacker.invalid'})).status,403);
  assert.equal((await req('/series/freeze-season/metrics/attendance',{method:'DELETE',cookie:reader})).status,200);
  assert.equal((await req('/series/freeze-season/subscription',{method:'DELETE',cookie:reader})).status,200);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM series_attendance').get().n,0);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM series_subscriptions').get().n,0);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
