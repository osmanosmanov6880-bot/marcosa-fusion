import assert from 'node:assert/strict';
import test from 'node:test';
import {createApp} from '../server.mjs';

test('season subscriptions deliver new releases once and honor cancellation, privacy and blocks',async()=>{
 const inviteCode='series-notifications-pilot',password='local-subscriptions-test-password';
 const app=createApp({inviteCode});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function request(path,cookie='',method='GET',body={}){
  const headers={Cookie:cookie};
  if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json',Origin:base});
  const r=await fetch(base+'/api'+path,{method,headers,...(method==='GET'?{}:{body:JSON.stringify(body)})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 async function member(username){
  const email=username+'@example.org';
  assert.equal((await request('/auth/register','','POST',{username,email,password,inviteCode})).status,201);
  const {cookie}=await request('/auth/login','','POST',{email,password});
  const {data}=await request('/auth/me',cookie);
  return {cookie,world:data.worlds[0],username};
 }
 try{
  const owner=await member('seasonhost149'),reader=await member('seasonreader149');
  const series='/series/lab-season',follow=series+'/subscription',reminders='/me/series-reminders';
  assert.equal((await request('/series',owner.cookie,'POST',{slug:'lab-season',title:'Сезон',worldId:owner.world.id})).status,201);
  async function episode(title){
   const post=await request('/posts',owner.cookie,'POST',{worldId:owner.world.id,status:'published',body:title});
   assert.equal(post.status,201);
   const id=post.data.id;
   assert.equal((await request(series+'/episodes',owner.cookie,'POST',{postId:id,title})).status,201);
   return id;
  }
  await episode('Первый выпуск');
  assert.equal((await request(follow,'','GET')).status,401);
  assert.equal((await request(follow,owner.cookie,'POST')).status,403);
  for(let n=0;n<2;n++)assert.equal((await request(follow,reader.cookie,'POST')).data.subscribed,true);
  assert.deepEqual((await request(reminders,reader.cookie)).data.items,[]);
  const second=await episode('Второй выпуск');
  assert.equal((await request(series+'/episodes',owner.cookie,'POST',{postId:second,title:'Второй выпуск'})).status,200);
  assert.deepEqual((await request(reminders,reader.cookie)).data.items.map(item=>item.postId),[second]);
  assert.deepEqual((await request(reminders,owner.cookie)).data.items,[]);
  assert.equal((await request('/me/profile',owner.cookie,'PATCH',{visibility:'private'})).status,200);
  assert.deepEqual((await request(reminders,reader.cookie)).data.items,[]);
  await episode('Закрытый выпуск');
  assert.equal((await request('/me/profile',owner.cookie,'PATCH',{visibility:'public'})).status,200);
  assert.deepEqual((await request(reminders,reader.cookie)).data.items.map(item=>item.postId),[second]);
  assert.equal((await request('/posts/'+second,owner.cookie,'PATCH',{status:'draft'})).status,200);
  assert.deepEqual((await request(reminders,reader.cookie)).data.items,[]);
  assert.equal((await request(follow,reader.cookie,'DELETE')).data.subscribed,false);
  await episode('Без подписки');
  assert.deepEqual((await request(reminders,reader.cookie)).data.items,[]);
  await request(follow,reader.cookie,'POST');
  await episode('Последний выпуск');
  assert.equal((await request('/users/'+reader.username+'/block',owner.cookie,'POST')).status,201);
  assert.deepEqual((await request(reminders,reader.cookie)).data.items,[]);
  assert.equal(app.db.prepare('SELECT count(*) n FROM series_subscriptions').get().n,0);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
