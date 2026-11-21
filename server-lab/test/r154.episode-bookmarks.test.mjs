import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('R154 reader-saved chapters: pagination, private filtering, personal export and incident erasure',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r154-bookmark-')),file=join(dir,'db.sqlite'),inviteCode='r154-bookmark-invite';
 let app=createApp({databasePath:file,inviteCode}),base='';
 async function start(){await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));base='http://127.0.0.1:'+app.server.address().port;}
 async function req(path,cookie='',method='GET',body,origin=base){
  const r=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:r.status,json:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const auth={username:name,email:name+'@example.org',password:'secure-bookmark-testing',inviteCode};
  assert.equal((await req('/auth/register','','POST',auth)).status,201);
  const login=await req('/auth/login','','POST',auth);
  const me=(await req('/auth/me',login.cookie)).json;
  return{cookie:login.cookie,world:me.worlds[0].id};
 }
 try{
  await start();
  const author=await account('r154bookmarkauthor'),reader=await account('r154bookmarkreader'),other=await account('r154bookmarkother');
  const slug='bookmark-story',series='/series/'+slug;
  assert.equal((await req('/series',author.cookie,'POST',{worldId:author.world,slug,title:'Bookmark story'})).status,201);
  const ids=[];
  for(let i=0;i<4;i++){
   const post=await req('/posts',author.cookie,'POST',{worldId:author.world,status:'published',body:'Source '+i});
   assert.equal(post.status,201);
   ids.push((await req(series+'/episodes',author.cookie,'POST',{postId:post.json.id,title:'Chapter '+i})).json.id);
  }
  const path=series+'/episodes/'+ids[0]+'/bookmark';
  assert.equal((await req(path)).status,401);
  assert.equal((await req(path,reader.cookie,'POST',{invalid:1})).status,400);
  assert.equal((await req(path,reader.cookie,'POST',{},'https://malicious.invalid')).status,403);
  assert.deepEqual((await req(path,reader.cookie,'POST',{})).json,{saved:true,added:true});
  assert.deepEqual((await req(path,reader.cookie,'POST',{})).json,{saved:true,added:false});
  assert.equal((await req(path,other.cookie)).json.saved,false);
  for(const id of ids.slice(1))assert.equal((await req(series+'/episodes/'+id+'/bookmark',reader.cookie,'POST',{})).status,200);
  const first=(await req('/me/series-bookmarks?limit=2',reader.cookie)).json;
  assert.equal(first.items.length,2);assert.ok(first.nextCursor);
  const second=(await req('/me/series-bookmarks?limit=2&cursor='+first.nextCursor,reader.cookie)).json;
  assert.equal(new Set([...first.items,...second.items].map(x=>x.episodeId)).size,4);
  for(const arg of ['?cursor=0','?limit=51','?cursor=1%20OR%201=1'])
   assert.equal((await req('/me/series-bookmarks'+arg,reader.cookie)).status,400);
  assert.equal((await req('/account/export',reader.cookie)).json.seriesBookmarks.length,4);
  app.db.prepare("UPDATE worlds SET visibility='private' WHERE id=?").run(author.world);
  assert.deepEqual((await req('/me/series-bookmarks',reader.cookie)).json.items,[]);
  assert.equal((await req(path,reader.cookie)).status,404);
  assert.equal((await req(path,reader.cookie,'DELETE',{})).json.removed,true);
  assert.equal((await req(path,reader.cookie,'DELETE',{})).json.removed,false);
  app.db.prepare("UPDATE worlds SET visibility='public' WHERE id=?").run(author.world);
  assert.equal((await req('/me/series-bookmarks',reader.cookie)).json.items.length,3);
  await app.close();app=createApp({databasePath:file,inviteCode,contentWritesDisabled:true});await start();
  assert.equal((await req(series+'/episodes/'+ids[1]+'/bookmark',reader.cookie,'DELETE',{})).status,200);
  assert.equal((await req(series+'/episodes/'+ids[2]+'/bookmark',reader.cookie,'POST',{})).status,503);
  assert.equal((await req('/me/series-bookmarks',reader.cookie)).json.items.length,2);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
