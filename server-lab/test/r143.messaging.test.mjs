import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R143: direct message requests, private group chats, block gates, moderation and export',async()=>{
 const app=createApp({inviteCode:'r143-private-messaging-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='r143-long-local-password';
 async function req(path,{method='GET',cookie,json,origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function account(username){
  let result=await req('/auth/register',{method:'POST',json:{username,email:username+'@example.org',password,inviteCode:'r143-private-messaging-invite'}});
  assert.equal(result.status,201);
  result=await req('/auth/login',{method:'POST',json:{email:username+'@example.org',password}});
  assert.equal(result.status,200);
  const cookie=result.cookie.split(';')[0];
  const profile=await req('/auth/me',{cookie});
  return{cookie,id:profile.data.user.id};
 }
 try{
  const alice=await account('alice143'),bob=await account('bob143'),carol=await account('carol143'),dave=await account('dave143');
  app.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(carol.id);
  assert.equal((await req('/conversations')).status,401,'inbox is private');

  let direct=await req('/conversations',{method:'POST',cookie:alice.cookie,json:{kind:'direct',username:'bob143'}});
  assert.equal(direct.status,201);assert.equal(direct.data.requestState,'outgoing_request');
  const directId=direct.data.id;
  let repeat=await req('/conversations',{method:'POST',cookie:alice.cookie,json:{kind:'direct',username:'bob143'}});
  assert.equal(repeat.status,200);assert.equal(repeat.data.id,directId,'one canonical direct thread');
  let inbox=await req('/conversations',{cookie:bob.cookie});
  assert.equal(inbox.data.items[0].requestState,'incoming_request');
  let sent=await req('/conversations/'+directId+'/messages',{method:'POST',cookie:alice.cookie,json:{body:'A single message request'}});
  assert.equal(sent.status,201);
  assert.equal((await req('/conversations/'+directId+'/messages',{method:'POST',cookie:alice.cookie,json:{body:'Second pending message'}})).status,409);
  assert.equal((await req('/conversations/'+directId+'/messages',{method:'POST',cookie:bob.cookie,json:{body:'Reply before acceptance'}})).status,403);
  let page=await req('/conversations/'+directId+'/messages',{cookie:bob.cookie});
  assert.equal(page.status,200);assert.equal(page.data.items[0].body,'A single message request');
  inbox=await req('/conversations',{cookie:bob.cookie});assert.equal(inbox.data.items[0].unread_count,1);
  let report=await req('/messages/'+sent.data.id+'/report',{method:'POST',cookie:bob.cookie,json:{reason:'abuse',detail:'Please review this message for policy compliance.'}});
  assert.equal(report.status,201);
  assert.equal((await req('/messages/'+sent.data.id+'/report',{method:'POST',cookie:bob.cookie,json:{reason:'abuse',detail:'Please review this message for policy compliance.'}})).status,409);
  assert.equal((await req('/mod/message-reports',{cookie:bob.cookie})).status,403);
  let queue=await req('/mod/message-reports',{cookie:carol.cookie});assert.equal(queue.data.items.length,1);
  assert.equal((await req('/mod/messages/'+sent.data.id+'/hide',{method:'POST',cookie:bob.cookie,json:{}})).status,403);
  assert.equal((await req('/mod/messages/'+sent.data.id+'/hide',{method:'POST',cookie:carol.cookie,json:{}})).status,200);
  page=await req('/conversations/'+directId+'/messages',{cookie:bob.cookie});assert.equal(page.data.items.length,0,'hidden messages leave participant history');

  assert.equal((await req('/conversations/'+directId+'/accept',{method:'POST',cookie:bob.cookie,json:{}})).status,200);
  let msg=await req('/conversations/'+directId+'/messages',{method:'POST',cookie:bob.cookie,json:{body:'Accepted reply'}});
  assert.equal(msg.status,201);
  await req('/conversations/'+directId+'/messages',{method:'POST',cookie:alice.cookie,json:{body:'Follow-up one'}});
  await req('/conversations/'+directId+'/messages',{method:'POST',cookie:alice.cookie,json:{body:'Follow-up two'}});
  page=await req('/conversations/'+directId+'/messages?limit=2',{cookie:bob.cookie});
  assert.equal(page.data.items.length,2);assert.ok(page.data.nextCursor);
  const older=await req('/conversations/'+directId+'/messages?limit=2&cursor='+page.data.nextCursor,{cookie:bob.cookie});
  assert.equal(older.data.items.length,1);
  inbox=await req('/conversations',{cookie:bob.cookie});assert.ok(inbox.data.items[0].unread_count>=2);
  assert.equal((await req('/conversations/'+directId+'/read',{method:'POST',cookie:bob.cookie,json:{}})).status,200);
  inbox=await req('/conversations',{cookie:bob.cookie});assert.equal(inbox.data.items[0].unread_count,0);

  const group=await req('/conversations',{method:'POST',cookie:alice.cookie,json:{kind:'group',title:'Cinema circle',participants:['bob143','carol143']}});
  assert.equal(group.status,201);assert.equal(group.data.members.length,3);
  const groupMessage=await req('/conversations/'+group.data.id+'/messages',{method:'POST',cookie:alice.cookie,json:{body:'Private group discussion'}});
  assert.equal(groupMessage.status,201);
  assert.equal((await req('/conversations/'+group.data.id+'/messages',{cookie:dave.cookie})).status,404);
  assert.equal((await req('/conversations/'+group.data.id+'/messages',{method:'POST',cookie:dave.cookie,json:{body:'Intrusion'}})).status,404);
  assert.equal((await req('/conversations',{method:'POST',cookie:alice.cookie,json:{kind:'group',title:'Duplicate group',participants:['bob143','bob143']}})).status,400);
  assert.equal((await req('/conversations/'+group.data.id+'/messages',{method:'POST',cookie:bob.cookie,json:{body:'Cross-origin'},origin:'https://attacker.example'})).status,403);
  assert.equal((await req('/users/bob143/block',{method:'POST',cookie:alice.cookie,json:{}})).status,201);
  assert.equal((await req('/conversations/'+directId+'/messages',{cookie:alice.cookie})).status,404,'a block immediately closes direct access');
  assert.equal((await req('/conversations/'+group.data.id+'/messages',{cookie:bob.cookie})).status,404,'group threads are hidden from a blocked participant');

  const exportAlice=await req('/account/export',{cookie:alice.cookie});
  assert.equal(exportAlice.status,200);assert.equal(exportAlice.data.conversations.length,2);
  assert.equal(exportAlice.data.privateMessages.some(item=>item.body==='Private group discussion'),true);
  assert.doesNotMatch(JSON.stringify(exportAlice.data),/password_hash|token_hash|r143-long-local-password/);
  const exportDave=await req('/account/export',{cookie:dave.cookie});assert.equal(exportDave.data.conversations.length,0);
  const requestToDave=await req('/conversations',{method:'POST',cookie:carol.cookie,json:{kind:'direct',username:'dave143'}});
  await req('/conversations/'+requestToDave.data.id+'/messages',{method:'POST',cookie:carol.cookie,json:{body:'Optional introduction'}});
  assert.equal((await req('/conversations/'+requestToDave.data.id+'/decline',{method:'POST',cookie:dave.cookie,json:{}})).status,200);
  assert.equal((await req('/conversations/'+requestToDave.data.id+'/messages',{cookie:carol.cookie})).status,404,'declined request history is unavailable');
  assert.equal((await req('/conversations',{method:'POST',cookie:carol.cookie,json:{kind:'direct',username:'dave143'}})).status,404,'declined sender cannot reopen the request');
  const reverseRequest=await req('/conversations',{method:'POST',cookie:dave.cookie,json:{kind:'direct',username:'carol143'}});
  assert.equal(reverseRequest.status,200);assert.equal(reverseRequest.data.requestState,'outgoing_request','the recipient can initiate a fresh request later');
  assert.equal((await req('/account',{method:'DELETE',cookie:alice.cookie,json:{confirm:'DELETE',password}})).status,200);
  assert.equal((await req('/conversations/'+group.data.id+'/messages',{cookie:bob.cookie})).status,200,'deleted block owner no longer hides the group from surviving members');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});

test('R143: content freeze blocks sending but preserves read receipts and message reporting',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'marcosa-r143-freeze-')),databasePath=join(folder,'lab.sqlite');
 let app=createApp({databasePath,inviteCode:'r143-freeze-messaging-invite'});
 const password='r143-freeze-password';
 async function request(path,{method='GET',cookie,json}={}){
  const base='http://127.0.0.1:'+app.server.address().port,headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function account(name){
  await request('/auth/register',{method:'POST',json:{username:name,email:name+'@example.org',password,inviteCode:'r143-freeze-messaging-invite'}});
  const login=await request('/auth/login',{method:'POST',json:{email:name+'@example.org',password}});
  return login.cookie.split(';')[0];
 }
 try{
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const alice=await account('frozenalice143'),bob=await account('frozenbob143');
  const direct=await request('/conversations',{method:'POST',cookie:alice,json:{kind:'direct',username:'frozenbob143'}});
  const message=await request('/conversations/'+direct.data.id+'/messages',{method:'POST',cookie:alice,json:{body:'A message request before freeze'}});
  await app.close();
  app=createApp({databasePath,inviteCode:'r143-freeze-messaging-invite',contentWritesDisabled:true});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  assert.equal((await request('/conversations/'+direct.data.id+'/messages',{method:'POST',cookie:alice,json:{body:'Blocked while frozen'}})).status,503);
  assert.equal((await request('/conversations/'+direct.data.id+'/read',{method:'POST',cookie:bob,json:{}})).status,200);
  assert.equal((await request('/messages/'+message.data.id+'/report',{method:'POST',cookie:bob,json:{reason:'spam',detail:'Please review this message during the freeze.'}})).status,201);
 }finally{if(app.server.listening)await app.close();rmSync(folder,{recursive:true,force:true});}
});
