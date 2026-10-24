import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R31 real first-party activity and truthful creator analytics',async t=>{
 const app=createApp({inviteCode:'r31-private-test-invitation'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function api(path,{method='GET',cookie,data}={}){
  const r=await fetch(base+'/api'+path,{
   method,headers:{...(cookie?{cookie}:{}),...(method==='GET'?{}:{origin:base,'content-type':'application/json'})},
   ...(method==='GET'?{}:{body:JSON.stringify(data??{})})
  });
  return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 async function user(username){
  let r=await api('/auth/register',{method:'POST',data:{
   username,email:username+'@example.net',password:'private-password-123456',inviteCode:'r31-private-test-invitation'
  }});
  assert.equal(r.status,201);
  r=await api('/auth/login',{method:'POST',data:{email:username+'@example.net',password:'private-password-123456'}});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  const me=await api('/auth/me',{cookie});
  return{cookie,id:me.body.user.id,world:me.body.worlds[0]};
 }
 try{
  const author=await user('worldauthor'),follower=await user('worldfriend'),mod=await user('worldmod');
  app.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(mod.id);
  const post=await api('/posts',{method:'POST',cookie:author.cookie,data:{worldId:author.world.id,body:'Original World story',status:'published'}});
  assert.equal(post.status,201);
  const draft=await api('/posts',{method:'POST',cookie:author.cookie,data:{worldId:author.world.id,body:'Private notes',status:'draft'}});
  assert.equal(draft.status,201);
  const follow='/worlds/'+author.world.slug+'/follow';
  let x=await api(follow,{method:'POST',cookie:follower.cookie,data:{}});
  assert.equal(x.status,201);
  x=await api(follow,{method:'POST',cookie:follower.cookie,data:{}});
  assert.equal(x.status,200);
  const comment=await api('/posts/'+post.body.id+'/comments',{method:'POST',cookie:follower.cookie,data:{body:'Nice work!'}});
  assert.equal(comment.status,201);
  const sponsorship=await api('/sponsors/proposals',{method:'POST',cookie:follower.cookie,data:{
   worldId:author.world.id,brandName:'Independent Studio',headline:'A transparent unpaid partnership',landingUrl:'https://example.org/story'
  }});
  assert.equal(sponsorship.status,201);
  await t.test('owner inbox persists distinct real events, duplicate follow does not inflate',async()=>{
   const inbox=await api('/me/notifications',{cookie:author.cookie});
   assert.equal(inbox.status,200);
   assert.equal(inbox.body.unread,3);
   assert.deepEqual(inbox.body.items.map(e=>e.kind).sort(),['new_comment','sponsor_requested','world_follow']);
   assert.ok(inbox.body.items.every(e=>e.actor==='worldfriend'));
   assert.ok(inbox.body.items.every(e=>e.read_at===null));
   const guest=await api('/me/notifications');assert.equal(guest.status,401);
   const friend=await api('/me/notifications',{cookie:follower.cookie});
   assert.equal(friend.body.items.length,0);
   const exported=await api('/account/export',{cookie:author.cookie});
   assert.equal(exported.status,200);assert.equal(exported.body.notifications.length,3);
   assert.ok(exported.body.notifications.every(n=>n.actor==='worldfriend'));
   assert.ok(!JSON.stringify(exported.body).includes('password_hash'));
   const otherExport=await api('/account/export',{cookie:follower.cookie});
   assert.deepEqual(otherExport.body.notifications,[]);
  });
  await t.test('creator insights are measured from SQLite, not made-up advertising reach',async()=>{
   const owner=await api('/me/insights',{cookie:author.cookie});
   assert.equal(owner.status,200);
   assert.deepEqual(owner.body.totals,{published:1,drafts:1,followers:1,replies:1});
   assert.equal(owner.body.worlds[0].uniqueResponders,1);
   assert.equal(owner.body.advertisingRevenue,null);
   assert.equal(owner.body.paidViews,null);
   const other=await api('/me/insights',{cookie:follower.cookie});
   assert.equal(other.body.totals.published,0);
   assert.equal(other.body.totals.followers,0);
   assert.ok(other.body.worlds.every(w=>w.slug!==author.world.slug));
  });
  await t.test('read-state is recipient-scoped, cannot mark someone else inbox',async()=>{
   const me=await api('/me/notifications',{cookie:author.cookie});
   const ids=me.body.items.map(n=>n.id);
   let r=await api('/me/notifications/read',{method:'POST',cookie:follower.cookie,data:{ids}});
   assert.equal(r.status,200);assert.equal(r.body.marked,0);
   r=await api('/me/notifications',{cookie:author.cookie});assert.equal(r.body.unread,3);
   r=await api('/me/notifications/read',{method:'POST',cookie:author.cookie,data:{ids:[ids[0]]}});
   assert.equal(r.status,200);assert.equal(r.body.marked,1);assert.equal(r.body.unread,2);
   r=await api('/me/notifications/read',{method:'POST',cookie:author.cookie,data:{ids:ids.slice(1)}});
   assert.equal(r.body.unread,0);
   r=await api('/me/notifications/read',{method:'POST',cookie:author.cookie,data:{ids:['bad']}});
   assert.equal(r.status,400);
   r=await api('/me/notifications?limit=999',{cookie:author.cookie});assert.equal(r.status,400);
  });
  await t.test('creator and moderator approvals notify only actual participants',async()=>{
   let r=await api('/sponsors/'+sponsorship.body.id+'/creator-decision',{method:'POST',cookie:author.cookie,data:{decision:'accept'}});
   assert.equal(r.status,200);
   const buyer=await api('/me/notifications',{cookie:follower.cookie});
   assert.deepEqual(buyer.body.items.map(e=>e.kind),['sponsor_accepted']);
   r=await api('/mod/sponsors/'+sponsorship.body.id+'/review',{method:'POST',cookie:mod.cookie,data:{decision:'approved'}});
   assert.equal(r.status,200);
   const buyerNext=await api('/me/notifications',{cookie:follower.cookie});
   assert.equal(buyerNext.body.items[0].kind,'sponsor_approved');
   const creatorNext=await api('/me/notifications',{cookie:author.cookie});
   assert.equal(creatorNext.body.items[0].kind,'sponsor_approved');
   const stranger=await api('/me/notifications',{cookie:mod.cookie});
   assert.equal(stranger.body.items.length,0);
  });
 }finally{await app.close();}
});
