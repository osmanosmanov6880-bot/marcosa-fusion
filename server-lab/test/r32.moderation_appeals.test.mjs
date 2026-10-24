import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R32: appeals due process, independent moderator, audit and privacy',async()=>{
 const app=createApp({inviteCode:'r32-appeal-code-long-enough'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const pass='r32-a-long-secret-password';
 async function req(path,{cookie,method='GET',json,origin}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers['Content-Type']='application/json';headers.Origin=origin||base;}
  const result=await fetch(base+'/api'+path,{method,headers,...(json!==undefined?{body:JSON.stringify(json)}:{})});
  return {status:result.status,data:await result.json(),cookie:result.headers.get('set-cookie')};
 }
 async function account(username){
  const email=username+'@example.org';
  let r=await req('/auth/register',{method:'POST',json:{email,username,password:pass,inviteCode:'r32-appeal-code-long-enough'}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',json:{email,password:pass}});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  r=await req('/auth/me',{cookie});
  return {cookie,id:r.data.user.id,world:r.data.worlds[0]};
 }
 try{
  const alice=await account('alice32');
  const bob=await account('bob32');
  const carol=await account('carol32');
  const dan=await account('dan32');
  app.db.prepare("UPDATE users SET role='moderator' WHERE id IN (?,?)").run(carol.id,dan.id);
  let r=await req('/posts',{cookie:alice.cookie,method:'POST',json:{worldId:alice.world.id,body:'Legitimate article awaiting moderation',status:'published'}});
  assert.equal(r.status,201);const post=r.data.id;
  r=await req('/posts/'+post+'/comments',{cookie:bob.cookie,method:'POST',json:{body:'A reasonable public response'}});
  assert.equal(r.status,201);const comment=r.data.id;
  r=await req('/appeals',{cookie:alice.cookie,method:'POST',json:{kind:'post',subjectId:post,reason:'My article was never hidden'}});
  assert.equal(r.status,409);
  r=await req('/mod/appeals',{cookie:alice.cookie});assert.equal(r.status,403);
  r=await req('/mod/moderation-audit',{cookie:bob.cookie});assert.equal(r.status,403);
  r=await req('/me/moderation');assert.equal(r.status,401);
  r=await req('/mod/posts/'+post+'/hide',{cookie:carol.cookie,method:'POST',json:{}});
  assert.equal(r.status,200);
  r=await req('/posts');assert.equal(r.data.items.length,0);
  r=await req('/me/moderation',{cookie:alice.cookie});
  assert.equal(r.status,200);assert.equal(r.data.hidden.length,1);assert.equal(r.data.appeals.length,0);
  r=await req('/me/moderation',{cookie:bob.cookie});assert.equal(r.data.hidden.length,0);
  r=await req('/appeals',{cookie:bob.cookie,method:'POST',json:{kind:'post',subjectId:post,reason:'Try to appeal someone else post'}});
  assert.equal(r.status,404);
  r=await req('/appeals',{cookie:alice.cookie,method:'POST',json:{kind:'post',subjectId:post,reason:'short'}});
  assert.equal(r.status,400);
  r=await req('/appeals',{cookie:alice.cookie,method:'POST',origin:'https://fake-origin.example.org',json:{kind:'post',subjectId:post,reason:'The decision appears wrong'}});
  assert.equal(r.status,403);
  r=await req('/appeals',{cookie:alice.cookie,method:'POST',json:{kind:'post',subjectId:post,reason:'This work follows the guidelines and should be restored'}});
  assert.equal(r.status,201);const appeal=r.data.id;
  r=await req('/appeals',{cookie:alice.cookie,method:'POST',json:{kind:'post',subjectId:post,reason:'This open case must not be duplicated'}});
  assert.equal(r.status,409);
  r=await req('/mod/appeals',{cookie:carol.cookie});assert.equal(r.status,200);assert.equal(r.data.items.length,1);
  assert.equal(r.data.items[0].appellant,'alice32');
  r=await req('/mod/appeals/'+appeal+'/resolve',{cookie:carol.cookie,method:'POST',json:{decision:'restored'}});
  assert.equal(r.status,403,'Moderator who hid the post cannot adjudicate appeal');
  r=await req('/mod/appeals/'+appeal+'/resolve',{cookie:bob.cookie,method:'POST',json:{decision:'restored'}});
  assert.equal(r.status,403);
  r=await req('/mod/appeals/'+appeal+'/resolve',{cookie:dan.cookie,method:'POST',json:{decision:'restore'}});
  assert.equal(r.status,400);
  r=await req('/mod/appeals/'+appeal+'/resolve',{cookie:dan.cookie,method:'POST',json:{decision:'restored'}});
  assert.equal(r.status,200);assert.equal(r.data.restored,true);
  r=await req('/posts');assert.equal(r.data.items.length,1);
  r=await req('/mod/appeals',{cookie:dan.cookie});assert.equal(r.data.items.length,0);
  r=await req('/mod/moderation-audit',{cookie:dan.cookie});
  assert.deepEqual(r.data.items.map(x=>x.action),['restored','hide']);
  r=await req('/me/moderation',{cookie:alice.cookie});
  assert.equal(r.data.hidden.length,0);assert.equal(r.data.appeals[0].status,'restored');
  const exported=await req('/account/export',{cookie:alice.cookie});
  assert.equal(exported.data.moderationAppeals.length,1);
  assert.equal(exported.data.moderationAppeals[0].status,'restored');
  assert.ok(!JSON.stringify(exported.data).includes('password_hash'));
  r=await req('/mod/comments/'+comment+'/hide',{cookie:carol.cookie,method:'POST',json:{}});
  assert.equal(r.status,200);
  r=await req('/posts/'+post+'/comments');assert.equal(r.data.items.length,0);
  r=await req('/me/moderation',{cookie:bob.cookie});assert.equal(r.data.hidden.length,1);
  r=await req('/appeals',{cookie:bob.cookie,method:'POST',json:{kind:'comment',subjectId:comment,reason:'This comment is legitimate and deserves independent review'}});
  assert.equal(r.status,201);const commentAppeal=r.data.id;
  r=await req('/mod/appeals/'+commentAppeal+'/resolve',{cookie:dan.cookie,method:'POST',json:{decision:'upheld'}});
  assert.equal(r.status,200);assert.equal(r.data.restored,false);
  r=await req('/posts/'+post+'/comments');assert.equal(r.data.items.length,0);
  r=await req('/me/moderation',{cookie:bob.cookie});assert.equal(r.data.appeals[0].status,'upheld');
  r=await req('/account',{cookie:alice.cookie,method:'DELETE',json:{confirm:'DELETE',password:pass}});
  assert.equal(r.status,200);
  r=await req('/mod/appeals',{cookie:dan.cookie});assert.equal(r.data.items.length,0);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
