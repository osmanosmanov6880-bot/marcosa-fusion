import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApp} from '../server.mjs';

test('R81 real SQLite incident freeze: protect posts/PNG, permit account safety, preserve existing data and recover',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r81-')),file=join(dir,'lab.sqlite');
 const password='R81-private-long-test-password',inviteCode='R81-local-incident-approval';
 let lab=null,base='';
 async function boot(freeze=false,media=false){
  lab=createApp({databasePath:file,inviteCode,contentWritesDisabled:freeze,publicMediaDisabled:media});
  await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
  base='http://127.0.0.1:'+lab.server.address().port;
 }
 async function request(path,{method='GET',cookie,data,origin=base,mime='application/json'}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']=mime;}
  const response=await fetch(base+path,{method,headers,
   ...(data===undefined?{}:{body:Buffer.isBuffer(data)?data:JSON.stringify(data)})});
  const type=response.headers.get('content-type')||'';
  return{status:response.status,json:type.includes('application/json')?await response.json():null,
   cookie:response.headers.get('set-cookie')?.split(';')[0]||null,headers:response.headers};
 }
 async function register(username){
  const email=username+'@example.invalid';
  const created=await request('/api/auth/register',{method:'POST',
   data:{username,email,password,inviteCode}});
  assert.equal(created.status,201,username);
  const login=await request('/api/auth/login',{method:'POST',data:{email,password}});
  assert.equal(login.status,200);
  const profile=await request('/api/auth/me',{cookie:login.cookie});
  assert.equal(profile.status,200);
  return{username,email,cookie:login.cookie,id:profile.json.user.id,world:profile.json.worlds[0]};
 }
 try{
  await boot();
  const owner=await register('owner81'),other=await register('other81'),moderator=await register('moderator81');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(moderator.id);
  let x=await request('/api/posts',{method:'POST',cookie:owner.cookie,data:{
    worldId:owner.world.id,body:'Public document survives incident mode',status:'published'}});
  assert.equal(x.status,201);const keepId=x.json.id;
  x=await request('/api/posts',{method:'POST',cookie:owner.cookie,data:{
    worldId:owner.world.id,body:'Safety report demonstrates real moderation',status:'published'}});
  assert.equal(x.status,201);const hideId=x.json.id;
  x=await request('/api/me/retention-consent',{method:'POST',cookie:owner.cookie,data:{consent:true}});
  assert.equal(x.status,200);
  await lab.close();lab=null;

  await boot(true,true);
  const health=await request('/api/health');
  assert.equal(health.status,200);
  assert.equal(health.json.contentWrites,'disabled');
  assert.equal(health.json.publicMediaDelivery,'disabled');
  const feed=await request('/api/posts');
  assert.equal(feed.status,200);
  assert.ok(feed.json.items.some(p=>p.id===keepId));
  const own=await request('/api/account/export',{cookie:owner.cookie});
  assert.equal(own.status,200);assert.equal(own.json.posts.length,2);
  const denied=[
   ['/api/auth/register','POST',null,{username:'new81',email:'new81@example.invalid',password,inviteCode}],
   ['/api/posts','POST',owner.cookie,{worldId:owner.world.id,body:'Disallowed post',status:'published'}],
   ['/api/worlds/'+owner.world.slug,'PATCH',owner.cookie,{title:'Frozen takeover attempt'}],
   ['/api/worlds','POST',owner.cookie,{slug:'new-world-81',title:'Blocked World'}],
   ['/api/posts/'+keepId,'DELETE',owner.cookie,{}],
   ['/api/mod/worlds/'+owner.world.slug+'/cover/review','POST',moderator.cookie,{decision:'approved'}]
  ];
  for(const [path,method,cookie,data] of denied){
   const result=await request(path,{method,cookie,data});
   assert.equal(result.status,503,path);
   assert.equal(result.json.contentWrites,'disabled');
   assert.equal(result.headers.get('retry-after'),'60');
   assert.equal(result.headers.get('x-marcosa-content-freeze'),'active');
   assert.equal(result.headers.get('cache-control'),'no-store');
  }
  // PNG is a separate body reader; the content-freeze must stop it first.
  const media=await request('/api/worlds/'+owner.world.slug+'/cover',
   {method:'POST',cookie:owner.cookie,data:Buffer.from('PNG-not-actually-accepted'),
    mime:'image/png'});
  assert.equal(media.status,503);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM posts').get().n,2);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_covers').get().n,0);
  // DNS rebinding / wrong-origin should still be rejected *before* freeze.
  const forged=await request('/api/posts',{method:'POST',cookie:owner.cookie,
    data:{worldId:owner.world.id,body:'cross site',status:'published'},origin:'https://attacker.invalid'});
  assert.equal(forged.status,403);

  // Security, privacy and abuse reports remain available while creation is frozen.
  x=await request('/api/auth/login',{method:'POST',data:{email:owner.email,password}});
  assert.equal(x.status,200);
  x=await request('/api/me/retention-consent',
   {method:'DELETE',cookie:owner.cookie,data:{}});
  assert.equal(x.status,200);assert.equal(x.json.pastActivityDeleted,true);
  x=await request('/api/reports',{method:'POST',cookie:other.cookie,
    data:{postId:hideId,reason:'abuse',detail:'Report remains available during an incident'}});
  assert.equal(x.status,201);
  x=await request('/api/mod/posts/'+hideId+'/hide',{method:'POST',cookie:moderator.cookie,data:{}});
  assert.equal(x.status,200);
  assert.equal(lab.db.prepare('SELECT status FROM posts WHERE id=?').get(hideId).status,'hidden');
  x=await request('/api/account',{method:'DELETE',cookie:other.cookie,data:{confirm:'DELETE',password}});
  assert.equal(x.status,200);assert.equal(x.json.deleted,true);
  const removed=await request('/api/auth/me',{cookie:other.cookie});assert.equal(removed.status,401);
  x=await request('/api/auth/logout',{method:'POST',cookie:moderator.cookie,data:{}});
  assert.equal(x.status,200);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await lab.close();lab=null;

  await boot(false,false);
  assert.equal((await request('/api/health')).json.contentWrites,'enabled');
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM posts').get().n,2);
  assert.equal((await request('/api/posts')).json.items.some(p=>p.id===keepId),true);
  x=await request('/api/posts',{method:'POST',cookie:owner.cookie,data:{
   worldId:owner.world.id,body:'New post after authorized recovery',status:'published'}});
  assert.equal(x.status,201);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM posts').get().n,3);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>createApp({contentWritesDisabled:'true'}),/Content freeze must be a boolean/);
 }finally{
  if(lab)await lab.close().catch(()=>{});
  rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
 }
});
test('R81 CLI rejects ambiguous incident-content env values before opening a port',()=>{
 const res=spawnSync(process.execPath,['server-lab/server.mjs'],{
  encoding:'utf8',timeout:3000,env:{...process.env,HOST:'127.0.0.1',
   MARCOSA_DISABLE_PUBLIC_MEDIA:'0',MARCOSA_FREEZE_CONTENT:'maybe'}});
 assert.equal(res.status,1,res.stderr);
 assert.match(res.stderr,/MARCOSA_FREEZE_CONTENT must be 0 or 1/);
});
