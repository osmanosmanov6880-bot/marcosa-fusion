import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R148: direct publication links resolve only to published, visible and unblocked posts',async()=>{
 const app=createApp({inviteCode:'r148-post-link-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,password='r148-long-local-password';
 async function req(path,{method='GET',cookie,json,html=false}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+(path.startsWith('/w/')?path:'/api'+path),{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:html?await response.text():await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function member(username){
  let result=await req('/auth/register',{method:'POST',json:{username,email:username+'@example.org',password,inviteCode:'r148-post-link-invite'}});
  assert.equal(result.status,201);result=await req('/auth/login',{method:'POST',json:{email:username+'@example.org',password}});
  assert.equal(result.status,200);const cookie=result.cookie.split(';')[0];result=await req('/auth/me',{cookie});
  return{cookie,world:result.data.worlds[0]};
 }
 try{
  const author=await member('author148'),visitor=await member('visitor148');
  const published=await req('/posts',{cookie:author.cookie,method:'POST',json:{worldId:author.world.id,status:'published',body:'Directly addressable public publication'}});
  const draft=await req('/posts',{cookie:author.cookie,method:'POST',json:{worldId:author.world.id,status:'draft',body:'Private draft'}});
  assert.equal(published.status,201);assert.equal(draft.status,201);
  let link=await req('/worlds/'+author.world.slug+'/posts/'+published.data.id,{cookie:visitor.cookie});
  assert.equal(link.status,200);assert.equal(link.data.item.body,'Directly addressable public publication');assert.equal(link.data.item.world,author.world.slug);
  assert.equal((await req('/worlds/'+author.world.slug+'/posts/'+draft.data.id,{cookie:visitor.cookie})).status,404);
  assert.equal((await req('/worlds/wrong-world/posts/'+published.data.id,{cookie:visitor.cookie})).status,404);
  assert.doesNotMatch(JSON.stringify(link.data),/email|password|salt|session/);
  let html=await req('/w/'+author.world.slug,{html:true});assert.equal(html.status,200);assert.match(html.data,/og:url/);
  const savedPath='/posts/'+published.data.id+'/save';
  assert.equal((await req(savedPath,{cookie:visitor.cookie,method:'POST',json:{}})).status,201);
  await req('/me/profile',{cookie:author.cookie,method:'PATCH',json:{visibility:'private'}});
  assert.equal((await req('/worlds/'+author.world.slug+'/posts/'+published.data.id,{cookie:visitor.cookie})).status,404,'private profile does not leak through a copied link');
  for(const endpoint of ['/posts','/worlds/'+author.world.slug+'/posts','/me/saved']){
   const result=await req(endpoint,{cookie:visitor.cookie});
   assert.equal(result.status,200);
   assert.ok(!result.data.items.some(row=>row.id===published.data.id),endpoint);
  }
  assert.equal((await req('/discover?q=Directly',{cookie:visitor.cookie})).data.posts.length,0);
  assert.equal((await req('/posts/'+published.data.id+'/comments',{cookie:visitor.cookie})).status,404);
  assert.equal((await req(savedPath,{cookie:visitor.cookie,method:'POST',json:{}})).status,404);
  assert.equal((await req('/users/author148/follow',{cookie:visitor.cookie,method:'POST',json:{}})).status,202);
  assert.equal((await req('/users/visitor148/follow-request',{cookie:author.cookie,method:'POST',json:{decision:'accept'}})).status,200);
  link=await req('/worlds/'+author.world.slug+'/posts/'+published.data.id,{cookie:visitor.cookie});assert.equal(link.status,200,'approved follower can open the permanent link');
  assert.equal((await req('/users/author148/block',{cookie:visitor.cookie,method:'POST',json:{}})).status,201);
  assert.equal((await req('/worlds/'+author.world.slug+'/posts/'+published.data.id,{cookie:visitor.cookie})).status,404,'block revokes direct link visibility');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
