import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {buildSeasonPortability,verifySeasonPortability,PORTABILITY_FORMAT} from '../series-portability.mjs';

test('R154 portable JSON is user-owned, checksum-verifiable and excludes other readers and credentials',async()=>{
 const inviteCode='r154-portability-invite',app=createApp({inviteCode});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function req(path,cookie='',method='GET',body){
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],
   disposition:response.headers.get('content-disposition')};
 }
 async function account(name){
  const auth={username:name,email:name+'@example.org',password:'portability-secret-password',inviteCode};
  assert.equal((await req('/auth/register','','POST',auth)).status,201);
  const login=await req('/auth/login','','POST',auth),me=(await req('/auth/me',login.cookie)).json;
  return{cookie:login.cookie,world:me.worlds[0].id,id:me.user.id};
 }
 try{
  const author=await account('r154exportauthor'),reader=await account('r154exportreader');
  const slug='portable-story',series='/series/'+slug;
  assert.equal((await req('/series',author.cookie,'POST',{worldId:author.world,slug,title:'Only author season'})).status,201);
  const post=(await req('/posts',author.cookie,'POST',{worldId:author.world,status:'published',body:'Private export original text'})).json;
  const episode=(await req(series+'/episodes',author.cookie,'POST',{postId:post.id,title:'First part'})).json;
  assert.equal((await req(series+'/subscription',reader.cookie,'POST',{})).status,200);
  assert.equal((await req(series+'/episodes/'+episode.id+'/bookmark',reader.cookie,'POST',{})).status,200);
  assert.equal((await req(series+'/metrics/attendance',reader.cookie,'POST',{episodeId:episode.id,consent:true})).status,200);
  assert.equal((await req(series+'/notifications',reader.cookie,'DELETE',{})).status,200);
  assert.equal((await req(series,author.cookie,'PATCH',{description:'Revised own description'})).status,200);
  assert.equal((await req(series+'/publication',author.cookie,'DELETE',{})).status,200);
  assert.equal((await req('/me/series-portability')).status,401);
  assert.equal((await req('/me/series-portability',author.cookie)).status,200);
  assert.equal((await req('/me/series-portability?all=true',author.cookie)).status,400);
  const exported=await req('/me/series-portability',author.cookie);
  assert.match(exported.disposition,/attachment;/);
  assert.equal(exported.json.format,PORTABILITY_FORMAT);
  assert.ok(verifySeasonPortability(exported.json));
  assert.equal(exported.json.payload.episodes[0].sourceBody,'Private export original text');
  assert.equal(exported.json.payload.seasons[0].archivedAt>0,true);
  assert.equal(exported.json.payload.editorialEvents.length>=4,true);
  assert.deepEqual(exported.json.payload.subscriptions,[]);
  assert.deepEqual(exported.json.payload.bookmarks,[]);
  assert.deepEqual(exported.json.payload.voluntaryMarks,[]);
  assert.doesNotMatch(JSON.stringify(exported.json),/r154exportreader|r154exportreader@example/);
  const changed=structuredClone(exported.json);
  changed.payload.episodes[0].sourceBody='forged contents';
  assert.equal(verifySeasonPortability(changed),false);
  const readerPack=(await req('/me/series-portability',reader.cookie)).json;
  assert.ok(verifySeasonPortability(readerPack));
  assert.equal(readerPack.payload.seasons.length,0);
  assert.equal(readerPack.payload.episodes.length,0);
  assert.equal(readerPack.payload.editorialEvents.length,0);
  assert.equal(readerPack.payload.subscriptions[0].notificationsMuted,1);
  assert.equal(readerPack.payload.bookmarks[0].episodeId,episode.id);
  assert.equal(readerPack.payload.voluntaryMarks[0].episodeId,episode.id);
  assert.doesNotMatch(JSON.stringify(readerPack),/Private export original text|r154exportauthor@example/);
  const first=buildSeasonPortability(app.db,reader.id,123000);
  const again=buildSeasonPortability(app.db,reader.id,124000);
  assert.equal(first.checksumSha256,again.checksumSha256,'GeneratedAt cannot modify signed payload');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
