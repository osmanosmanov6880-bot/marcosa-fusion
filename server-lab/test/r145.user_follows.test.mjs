import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R145: people follow graph supports consent for private profiles and merges into following feed',async()=>{
 const app=createApp({inviteCode:'r145-user-follow-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,password='r145-long-local-password';
 async function req(path,{method='GET',cookie,json,origin=base,html=false}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+(path.startsWith('/u/')?path:'/api'+path),{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:html?await response.text():await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function account(username){
  let r=await req('/auth/register',{method:'POST',json:{username,email:username+'@example.org',password,inviteCode:'r145-user-follow-invite'}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',json:{email:username+'@example.org',password}});
  assert.equal(r.status,200);const cookie=r.cookie.split(';')[0];
  r=await req('/auth/me',{cookie});return{cookie,id:r.data.user.id,world:r.data.worlds[0]};
 }
 try{
  const alice=await account('alice145'),bob=await account('bob145'),owner=await account('owner145'),eve=await account('eve145');
  await req('/me/profile',{cookie:alice.cookie,method:'PATCH',json:{displayName:'Alice Visible',bio:'Visible bio',interests:['cinema'],visibility:'public'}});
  await req('/me/profile',{cookie:owner.cookie,method:'PATCH',json:{displayName:'Owner Private',bio:'Only approved people can read this.',visibility:'private'}});
  const alicePost=await req('/posts',{cookie:alice.cookie,method:'POST',json:{worldId:alice.world.id,status:'published',body:'Alice creator post'}});
  const ownerPost=await req('/posts',{cookie:owner.cookie,method:'POST',json:{worldId:owner.world.id,status:'published',body:'Private profile author post'}});
  assert.equal(alicePost.status,201);assert.equal(ownerPost.status,201);

  let follow=await req('/users/alice145/follow',{cookie:bob.cookie,method:'POST',json:{}});
  assert.equal(follow.status,201);assert.equal(follow.data.state,'active');
  let feed=await req('/feed/following',{cookie:bob.cookie});assert.ok(feed.data.items.some(post=>post.id===alicePost.data.id));
  assert.ok(!feed.data.items.some(post=>post.id===ownerPost.data.id));
  let page=await req('/people/alice145',{cookie:bob.cookie});assert.equal(page.status,200);assert.equal(page.data.relationship.state,'active');
  assert.equal(page.data.followers,1);
  follow=await req('/users/alice145/follow',{cookie:bob.cookie,method:'POST',json:{}});assert.equal(follow.status,200,'follow is duplicate-safe');
  assert.equal((await req('/me/following',{cookie:bob.cookie})).data.items[0].status,'active');
  await req('/users/alice145/follow',{cookie:bob.cookie,method:'DELETE',json:{}});
  feed=await req('/feed/following',{cookie:bob.cookie});assert.ok(!feed.data.items.some(post=>post.id===alicePost.data.id));

  follow=await req('/users/owner145/follow',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(follow.status,202);assert.equal(follow.data.state,'pending');
  let privatePage=await req('/people/owner145',{cookie:alice.cookie});
  assert.equal(privatePage.data.scope,'private-profile-request');
  assert.equal('bio' in privatePage.data.person,false);
  assert.equal(privatePage.data.posts.length,0);
  assert.equal((await req('/people/owner145')).status,404,'anonymous visitors cannot enumerate a private profile');
  assert.equal((await req('/people?q=Owner')).data.items.some(person=>person.username==='owner145'),false);
  const pendingHtml=await req('/u/owner145',{cookie:alice.cookie,html:true});
  assert.equal(pendingHtml.status,200);assert.match(pendingHtml.data,/data-profile-readable="false"/);
  const requests=await req('/me/follow-requests',{cookie:owner.cookie});assert.equal(requests.data.items.length,1);
  assert.equal((await req('/users/alice145/follow-request',{cookie:eve.cookie,method:'POST',json:{decision:'accept'}})).status,404);
  assert.equal((await req('/users/alice145/follow-request',{cookie:owner.cookie,method:'POST',json:{decision:'accept'}})).status,200);
  privatePage=await req('/people/owner145',{cookie:alice.cookie});
  assert.equal(privatePage.data.person.bio,'Only approved people can read this.');
  assert.equal(privatePage.data.relationship.state,'active');
  feed=await req('/feed/following',{cookie:alice.cookie});assert.ok(feed.data.items.some(post=>post.id===ownerPost.data.id));
  assert.equal((await req('/me/follow-requests',{cookie:owner.cookie})).data.items.length,0);

  const exported=await req('/account/export',{cookie:alice.cookie});
  assert.ok(exported.data.userFollows.some(edge=>edge.username==='owner145'&&edge.status==='active'));
  assert.doesNotMatch(JSON.stringify(exported.data),/password_hash|token_hash|r145-long-local-password/);
  assert.equal((await req('/users/owner145/follow-request',{cookie:alice.cookie,method:'POST',json:{decision:'accept'}})).status,404,'a follower cannot decide another user request');

  await req('/users/owner145/block',{cookie:alice.cookie,method:'POST',json:{}});
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM user_follows WHERE (follower_id=? AND followed_id=?) OR (follower_id=? AND followed_id=?)').get(alice.id,owner.id,owner.id,alice.id).n,0,'blocking removes follows in both directions');
  assert.equal((await req('/people/owner145',{cookie:alice.cookie})).status,404);
  feed=await req('/feed/following',{cookie:alice.cookie});assert.ok(!feed.data.items.some(post=>post.id===ownerPost.data.id));
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
