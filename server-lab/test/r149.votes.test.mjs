import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('season polls keep one vote, close at the deadline, link a continuation and respect current access',async t=>{
 let clock=Date.now();
 const inviteCode='vote-season-invitation',password='secure-voting-passphrase';
 const app=createApp({inviteCode,now:()=>clock});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 async function call(path,cookie,method='GET',body={}){
  const headers=cookie?{Cookie:cookie}:{};
  if(method!=='GET') Object.assign(headers,{Origin:base,'Content-Type':'application/json'});
  const response=await fetch(base+'/api'+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(username){
  const email=username+'@example.org';
  assert.equal((await call('/auth/register',null,'POST',{username,email,password,inviteCode})).status,201);
  return (await call('/auth/login',null,'POST',{email,password})).cookie;
 }
 const author=await account('pollauthor'),reader=await account('pollreader');
 const worldId=(await call('/auth/me',author)).data.worlds[0].id;
 assert.equal((await call('/series',author,'POST',{worldId,title:'A serial',slug:'demo-serial'})).status,201);
 async function add(title) {
  const post=await call('/posts',author,'POST',{worldId,body:title,status:'published'});
  const episode=await call('/series/demo-serial/episodes',author,'POST',{postId:post.data.id,title});
  assert.equal(episode.status,201);return episode.data.id;
 }
 const first=await add('Beginning'),next=await add('Continuation');
 const url='/series/demo-serial/episodes/'+first+'/poll';
 const proposal={question:'Which path?',options:['Forest','River'],closesAt:clock+20000};
 assert.equal((await call(url,reader,'POST',proposal)).status,403);
 assert.equal((await call(url,author,'POST',proposal)).status,201);
 assert.equal((await call(url+'/vote',author,'POST',{choice:1})).status,403);
 assert.equal((await call(url+'/vote',reader,'POST',{choice:0})).status,200);
 assert.equal((await call(url+'/vote',reader,'POST',{choice:1})).status,200);
 assert.equal((await call(url+'/vote',reader,'DELETE')).status,200);
 assert.equal((await call(url+'/vote',reader,'POST',{choice:1})).status,200);
 assert.equal((await call(url,reader)).data.poll.mine,1);
 assert.equal((await call(url,null)).data.poll.counts,null);
 const result={episodeId:next,note:'Viewers chose the river.'};
 assert.equal((await call(url+'/result',author,'POST',result)).status,409);
 clock=proposal.closesAt;
 assert.equal((await call(url+'/vote',reader,'POST',{choice:0})).status,409);
 assert.equal((await call(url+'/result',reader,'POST',result)).status,403);
 assert.equal((await call(url+'/result',author,'POST',{...result,episodeId:first})).status,400);
 assert.equal((await call(url+'/result',author,'POST',result)).status,201);
 assert.equal((await call(url+'/result',author,'POST',result)).status,200);
 const final=(await call(url,null)).data.poll;
 assert.deepEqual(final.counts,[0,1]); assert.equal(final.mine,null);
 assert.equal(final.result.href,'/series/demo-serial#episode-'+next);
 assert.equal((await call('/users/pollreader/block',author,'POST')).status,201);
 assert.equal((await call(url,reader)).status,404);
 assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
