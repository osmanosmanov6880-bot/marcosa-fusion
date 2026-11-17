import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R144: public author profiles are owner-edited, searchable, private by choice, block-aware and portable',async()=>{
 const app=createApp({inviteCode:'r144-author-profile-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,password='r144-long-local-password';
 async function req(path,{method='GET',cookie,json,origin=base,html=false}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+(path.startsWith('/u/')?path:'/api'+path),{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:html?await response.text():await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function account(username){
  let r=await req('/auth/register',{method:'POST',json:{username,email:username+'@example.org',password,inviteCode:'r144-author-profile-invite'}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',json:{email:username+'@example.org',password}});
  assert.equal(r.status,200);const cookie=r.cookie.split(';')[0];
  r=await req('/auth/me',{cookie});return{cookie,id:r.data.user.id,world:r.data.worlds[0]};
 }
 try{
  const alice=await account('alice144'),bob=await account('bob144');
  assert.equal((await req('/me/profile')).status,401);
  let r=await req('/me/profile',{cookie:alice.cookie,method:'PATCH',json:{displayName:'Alice North',bio:'Photographer and filmmaker.',interests:['cinema','travel'],website:'https://alice.example.org',visibility:'public'}});
  assert.equal(r.status,200);assert.deepEqual(r.data.profile.interests,['cinema','travel']);
  assert.equal((await req('/me/profile',{cookie:alice.cookie,method:'PATCH',json:{website:'http://unsafe.example.org'}})).status,400);
  assert.equal((await req('/me/profile',{cookie:alice.cookie,method:'PATCH',json:{interests:Array(9).fill('cinema')}})).status,400);
  assert.equal((await req('/me/profile',{cookie:alice.cookie,method:'PATCH',json:{bio:'tamper'},origin:'https://attacker.example'})).status,403);
  assert.equal((await req('/me/profile',{cookie:bob.cookie,method:'PATCH',json:{role:'moderator'}})).status,400);

  const signed=await req('/posts',{cookie:alice.cookie,method:'POST',json:{worldId:alice.world.id,status:'published',body:'A public profile story'}});
  assert.equal(signed.status,201);
  r=await req('/people/alice144');assert.equal(r.status,200);assert.equal(r.data.person.displayName,'Alice North');
  assert.equal(r.data.posts.length,1);assert.equal(r.data.posts[0].body,'A public profile story');
  assert.equal('email' in r.data.person,false);assert.equal('id' in r.data.person,false);
  r=await req('/people?q=North',{cookie:bob.cookie});assert.equal(r.status,200);assert.equal(r.data.items[0].username,'alice144');
  const share=await req('/u/alice144',{html:true});assert.equal(share.status,200);assert.match(share.data,/data-profile-page="true"/);assert.match(share.data,/og:title/);

  assert.equal((await req('/users/alice144/block',{cookie:bob.cookie,method:'POST',json:{}})).status,201);
  assert.equal((await req('/people/alice144',{cookie:bob.cookie})).status,404);
  r=await req('/people?q=North',{cookie:bob.cookie});assert.ok(!r.data.items.some(item=>item.username==='alice144'));
  assert.equal((await req('/u/alice144',{cookie:bob.cookie,html:true})).status,404);

  r=await req('/me/profile',{cookie:alice.cookie,method:'PATCH',json:{visibility:'private'}});assert.equal(r.status,200);
  assert.equal((await req('/people/alice144')).status,404);
  assert.equal((await req('/u/alice144',{html:true})).status,404);
  assert.equal((await req('/people/alice144',{cookie:alice.cookie})).status,200,'owner can inspect own private profile');
  assert.equal((await req('/u/alice144',{cookie:alice.cookie,html:true})).status,200,'owner can open private profile route');
  const exported=await req('/account/export',{cookie:alice.cookie});assert.equal(exported.status,200);
  assert.deepEqual(exported.data.profile.interests,['cinema','travel']);assert.equal(exported.data.profile.visibility,'private');
  assert.doesNotMatch(JSON.stringify(exported.data),/password_hash|token_hash|r144-long-local-password/);
  assert.equal((await req('/account',{cookie:alice.cookie,method:'DELETE',json:{confirm:'DELETE',password}})).status,200);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM profile_cards WHERE user_id=?').get(alice.id).n,0,'account removal cascades profile data');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
