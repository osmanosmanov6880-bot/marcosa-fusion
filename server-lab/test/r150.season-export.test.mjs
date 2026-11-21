import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('season export includes owned material and excludes other participants',async()=>{
 const app=createApp({inviteCode:'r150-export-invitation'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function request(path,method='GET',cookie='',body){
  const response=await fetch(base+'/api'+path,{method,headers:{cookie,origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(name){
  const data={username:name,email:name+'@example.org',password:'r150-secure-password',inviteCode:'r150-export-invitation'};
  assert.equal((await request('/auth/register','POST','',data)).status,201);
  const login=await request('/auth/login','POST','',data);
  return {cookie:login.cookie,world:(await request('/auth/me','GET',login.cookie)).data.worlds[0]};
 }
 try{
  const author=await account('author150'),other=await account('other150');
  const post=await request('/posts','POST',author.cookie,{worldId:author.world.id,body:'Original episode',status:'published'});
  await request('/series','POST',author.cookie,{worldId:author.world.id,slug:'season150',title:'Season 150'});
  const episode=await request('/series/season150/episodes','POST',author.cookie,{postId:post.data.id,title:'First'});
  await request('/series/season150/metrics/effort','POST',author.cookie,{episodeId:episode.data.id,minutes:45});
  await request('/series/season150/metrics/attendance','POST',other.cookie,{episodeId:episode.data.id,consent:true});
  const exported=await request('/account/export','GET',author.cookie);
  assert.equal(exported.status,200);
  assert.equal(exported.data.seasonData.seasons[0].slug,'season150');
  assert.equal(exported.data.seasonData.episodes[0].minutes,45);
  assert.doesNotMatch(JSON.stringify(exported.data.seasonData),/other150|other150@example/);
  const otherExport=await request('/account/export','GET',other.cookie);
  assert.deepEqual(otherExport.data.seasonData.seasons,[]);
  assert.equal(otherExport.data.seasonAttendance.length,1);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
