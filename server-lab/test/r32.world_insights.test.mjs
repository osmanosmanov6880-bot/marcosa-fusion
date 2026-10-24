import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R32 private World dashboard reflects real followers, posts and unique responders',async()=>{
 const lab=createApp({inviteCode:'test-r32-invitation-long-enough'});
 await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+lab.server.address().port;
 async function req(route,{method='GET',cookie,data}={}){
  const r=await fetch(base+'/api'+route,{
   method,headers:{...(cookie?{cookie}:{}),...(method==='GET'?{}:{origin:base,'content-type':'application/json'})},
   ...(method==='GET'?{}:{body:JSON.stringify(data??{})})
  });
  return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 async function register(username){
  const password='private-test-password-2026';
  let result=await req('/auth/register',{method:'POST',data:{username,email:username+'@example.net',password,inviteCode:'test-r32-invitation-long-enough'}});
  assert.equal(result.status,201);
  result=await req('/auth/login',{method:'POST',data:{email:username+'@example.net',password}});
  assert.equal(result.status,200);
  const cookie=result.cookie.split(';')[0];
  const me=await req('/auth/me',{cookie});
  return{cookie,world:me.data.worlds[0]};
 }
 try{
  const a=await register('creatorr32'),b=await register('followerr32'),c=await register('reviewerr32');
  let own=await req('/me/insights',{cookie:a.cookie});
  assert.equal(own.status,200);
  assert.deepEqual(own.data.totals,{published:0,drafts:0,followers:0,replies:0});
  assert.equal(own.data.paidViews,null);
  assert.equal(own.data.advertisingRevenue,null);
  assert.equal((await req('/me/insights')).status,401);
  const draft=await req('/posts',{method:'POST',cookie:a.cookie,data:{worldId:a.world.id,body:'Private work notes',status:'draft'}});
  assert.equal(draft.status,201);
  const published=await req('/posts',{method:'POST',cookie:a.cookie,data:{worldId:a.world.id,body:'World creator work',status:'published'}});
  assert.equal(published.status,201);
  const follower=await req('/worlds/'+a.world.slug+'/follow',{method:'POST',cookie:b.cookie,data:{}});
  assert.equal(follower.status,201);
  const comment=body=>req('/posts/'+published.data.id+'/comments',{method:'POST',cookie:b.cookie,data:{body}});
  assert.equal((await comment('A thoughtful reply')).status,201);
  assert.equal((await comment('Another thoughtful reply')).status,201);
  assert.equal((await req('/posts/'+published.data.id+'/comments',{method:'POST',cookie:c.cookie,data:{body:'Independent opinion'}})).status,201);
  own=await req('/me/insights',{cookie:a.cookie});
  assert.equal(own.data.mode,'verified-local-records');
  assert.deepEqual(own.data.totals,{published:1,drafts:1,followers:1,replies:3});
  assert.equal(own.data.worlds.length,1);
  assert.equal(own.data.worlds[0].uniqueResponders,2);
  assert.equal(own.data.worlds[0].slug,a.world.slug);
  const bStats=await req('/me/insights',{cookie:b.cookie});
  assert.deepEqual(bStats.data.totals,{published:0,drafts:0,followers:0,replies:0});
  assert.ok(!bStats.data.worlds.some(w=>w.slug===a.world.slug));
  const hidden=await req('/posts/'+published.data.id,{method:'PATCH',cookie:a.cookie,data:{status:'draft'}});
  assert.equal(hidden.status,200);
  own=await req('/me/insights',{cookie:a.cookie});
  assert.deepEqual(own.data.totals,{published:0,drafts:2,followers:1,replies:0});
  assert.equal(own.data.worlds[0].uniqueResponders,0);
 }finally{await lab.close();}
});
