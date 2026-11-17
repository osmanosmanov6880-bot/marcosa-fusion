import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R146: post reactions are unique, private-profile aware, block-aware and portable',async()=>{
 const app=createApp({inviteCode:'r146-post-reaction-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,password='r146-long-local-password';
 async function req(path,{method='GET',cookie,json,origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function account(username){
  let r=await req('/auth/register',{method:'POST',json:{username,email:username+'@example.org',password,inviteCode:'r146-post-reaction-invite'}});
  assert.equal(r.status,201);r=await req('/auth/login',{method:'POST',json:{email:username+'@example.org',password}});
  assert.equal(r.status,200);const cookie=r.cookie.split(';')[0];r=await req('/auth/me',{cookie});
  return{cookie,id:r.data.user.id,world:r.data.worlds[0]};
 }
 try{
  const author=await account('author146'),reader=await account('reader146'),blocked=await account('blocked146');
  const post=await req('/posts',{cookie:author.cookie,method:'POST',json:{worldId:author.world.id,status:'published',body:'Original public story'}});
  const draft=await req('/posts',{cookie:author.cookie,method:'POST',json:{worldId:author.world.id,status:'draft',body:'Unpublished draft'}});
  assert.equal(post.status,201);assert.equal(draft.status,201);
  assert.equal((await req('/posts/reactions?ids='+post.data.id)).data.items[0].total,0);
  let result=await req('/posts/'+post.data.id+'/reaction',{cookie:reader.cookie,method:'POST',json:{reaction:'like'}});
  assert.equal(result.status,201);assert.equal(result.data.changed,true);
  result=await req('/posts/'+post.data.id+'/reaction',{cookie:reader.cookie,method:'POST',json:{reaction:'support'}});
  assert.equal(result.status,200);assert.equal(result.data.changed,true);
  let summary=await req('/posts/reactions?ids='+post.data.id,{cookie:author.cookie});
  assert.equal(summary.status,200);assert.deepEqual(summary.data.items[0].counts,{like:0,insightful:0,support:1,celebrate:0});assert.equal(summary.data.items[0].total,1);
  summary=await req('/posts/reactions?ids='+post.data.id,{cookie:reader.cookie});assert.equal(summary.data.items[0].mine,'support');
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:author.cookie,method:'POST',json:{reaction:'like'}})).status,403,'authors cannot react to themselves');
  assert.equal((await req('/posts/'+draft.data.id+'/reaction',{cookie:reader.cookie,method:'POST',json:{reaction:'like'}})).status,404,'drafts cannot receive reactions');
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:reader.cookie,method:'POST',json:{reaction:'love'}})).status,400);
  assert.equal((await req('/posts/reactions?ids='+post.data.id+','+post.data.id)).status,400,'duplicate IDs are rejected');
  const exported=await req('/account/export',{cookie:reader.cookie});assert.equal(exported.status,200);assert.equal(exported.data.reactions.length,1);assert.equal(exported.data.reactions[0].reaction,'support');
  await req('/me/profile',{cookie:author.cookie,method:'PATCH',json:{visibility:'private'}});
  assert.deepEqual((await req('/posts/reactions?ids='+post.data.id,{cookie:reader.cookie})).data.items,[],'private-profile counters stay hidden without consent');
  assert.equal((await req('/users/author146/follow',{cookie:reader.cookie,method:'POST',json:{}})).status,202);
  assert.equal((await req('/users/reader146/follow-request',{cookie:author.cookie,method:'POST',json:{decision:'accept'}})).status,200);
  assert.equal((await req('/posts/reactions?ids='+post.data.id,{cookie:reader.cookie})).data.items[0].total,1,'accepted followers can see private-profile reactions');
  await req('/users/blocked146/block',{cookie:author.cookie,method:'POST',json:{}});
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:blocked.cookie,method:'POST',json:{reaction:'like'}})).status,403,'blocked pair cannot react');
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:reader.cookie,method:'DELETE',json:{}})).data.removed,true);
  assert.equal((await req('/posts/'+post.data.id+'/reaction',{cookie:reader.cookie,method:'DELETE',json:{}})).data.removed,false,'remove is idempotent');
  assert.equal((await req('/posts/reactions?ids='+post.data.id,{cookie:author.cookie})).data.items[0].total,0);
  assert.equal((await req('/posts/reactions?ids=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31')).status,400);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
