import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R39: password rotation atomically revokes all sessions; others can be revoked independently',async()=>{
 const lab=createApp({inviteCode:'r39-private-local-invite'});
 await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+lab.server.address().port;
 const oldPassword='old-strong-password-r39',newPassword='new-strong-password-r39';
 async function request(path,{method='GET',cookie,json,from=origin}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=from;headers['Content-Type']='application/json';}
  const response=await fetch(origin+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function register(name){
  const r=await request('/auth/register',{method:'POST',json:{
   username:name,email:name+'@example.net',password:oldPassword,inviteCode:'r39-private-local-invite'
  }});
  assert.equal(r.status,201);
 }
 async function login(name,password=oldPassword){
  const r=await request('/auth/login',{method:'POST',json:{email:name+'@example.net',password}});
  return {status:r.status,cookie:r.cookie?.split(';')[0],data:r.data};
 }
 try{
  await register('alice39');await register('bob39');
  const first=await login('alice39'),second=await login('alice39'),bob=await login('bob39');
  for(const x of [first,second,bob])assert.equal(x.status,200);
  let x=await request('/me/security');assert.equal(x.status,401);
  x=await request('/me/security',{cookie:first.cookie});
  assert.equal(x.status,200);assert.equal(x.data.activeSessions,2);
  assert.equal(x.data.emailVerified,false);assert.equal(x.data.recoveryConfigured,false);
  assert.ok(x.data.currentExpiresAt>Date.now());
  assert.doesNotMatch(JSON.stringify(x.data),/salt|hash|token|password/i);
  const dbUser=lab.db.prepare("SELECT id,salt,password_hash FROM users WHERE username='alice39'").get();
  x=await request('/me/security/revoke-others',{cookie:second.cookie,method:'POST',json:{currentPassword:'wrong'}});
  assert.equal(x.status,403);
  x=await request('/me/security/revoke-others',{cookie:first.cookie,method:'POST',from:'https://not-local.example',json:{currentPassword:oldPassword}});
  assert.equal(x.status,403);
  x=await request('/me/security/revoke-others',{cookie:first.cookie,method:'POST',json:{currentPassword:oldPassword}});
  assert.equal(x.status,200);assert.equal(x.data.revoked,1);assert.equal(x.data.currentSessionActive,true);
  x=await request('/auth/me',{cookie:second.cookie});assert.equal(x.status,401);
  x=await request('/auth/me',{cookie:first.cookie});assert.equal(x.status,200);
  x=await request('/auth/me',{cookie:bob.cookie});assert.equal(x.status,200);
  x=await request('/me/security',{cookie:first.cookie});assert.equal(x.data.activeSessions,1);
  const third=await login('alice39');assert.equal(third.status,200);
  x=await request('/me/security/change-password',{cookie:first.cookie,method:'POST',
   json:{currentPassword:oldPassword,newPassword:'short'}});
  assert.equal(x.status,400);
  x=await request('/me/security/change-password',{cookie:first.cookie,method:'POST',
   json:{currentPassword:'wrong-current-password',newPassword}});
  assert.equal(x.status,403);
  x=await request('/me/security/change-password',{cookie:first.cookie,method:'POST',
   json:{currentPassword:oldPassword,newPassword:oldPassword}});
  assert.equal(x.status,400);
  x=await request('/auth/me',{cookie:third.cookie});assert.equal(x.status,200);
  x=await request('/me/security/change-password',{cookie:first.cookie,method:'POST',
   json:{currentPassword:oldPassword,newPassword}});
  assert.equal(x.status,200);assert.equal(x.data.passwordChanged,true);
  assert.equal(x.data.sessionsRevoked,2);assert.equal(x.data.requiresLogin,true);
  assert.match(x.cookie,/Max-Age=0/);
  assert.doesNotMatch(JSON.stringify(x.data),/salt|hash|token|currentPassword|newPassword/);
  x=await request('/auth/me',{cookie:first.cookie});assert.equal(x.status,401);
  x=await request('/auth/me',{cookie:third.cookie});assert.equal(x.status,401);
  x=await request('/auth/me',{cookie:bob.cookie});assert.equal(x.status,200);
  x=await login('alice39');assert.equal(x.status,401,'old password rejected');
  const newLogin=await login('alice39',newPassword);assert.equal(newLogin.status,200);
  const changed=lab.db.prepare("SELECT salt,password_hash FROM users WHERE username='alice39'").get();
  assert.notEqual(changed.salt,dbUser.salt);
  assert.notEqual(changed.password_hash,dbUser.password_hash);
  const exported=await request('/account/export',{cookie:newLogin.cookie});
  assert.equal(exported.status,200);
  assert.doesNotMatch(JSON.stringify(exported.data),/salt|password_hash|token_hash|new-strong-password-r39/);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await lab.close();}
});
