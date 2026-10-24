import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApp} from '../server.mjs';

const INVITE='invite-r28-verified-private';
let app,base;

async function request(path,{method='GET',json:body,cookie,origin}={}){
 const headers={};
 if(method!=='GET'){
  headers.Origin=origin??base;
  headers['Content-Type']='application/json';
 }
 if(cookie)headers.Cookie=cookie;
 const response=await fetch(base+path,{
  method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})
 });
 return{status:response.status,json:await response.json(),headers:response.headers};
}
const reg=(username,password='super-secret-passphrase-2026')=>({
 username,email:username+'@example.net',password,inviteCode:INVITE
});
const login=async(username,password='super-secret-passphrase-2026')=>{
 const answer=await request('/api/auth/login',{method:'POST',json:{email:username+'@example.net',password}});
 assert.equal(answer.status,200);
 const cookie=answer.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 return cookie.split(';')[0];
};
test('R28 complete local social vertical slice / genuine HTTP+SQLite authorization',async t=>{
 app=createApp({inviteCode:INVITE});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 base='http://127.0.0.1:'+app.server.address().port;
 try{
  await t.test('healthy loopback lab serves real HTML + locked security headers',async()=>{
   const h=await request('/api/health');
   assert.equal(h.status,200);assert.equal(h.json.production,false);
   const html=await fetch(base+'/');
   assert.equal(html.status,200);
   assert.match(await html.text(),/Мир начинается/);
   assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);
   assert.equal(html.headers.get('x-frame-options'),'DENY');
   const js=await fetch(base+'/app.js');assert.equal(js.status,200);
   const source=await js.text();assert.match(source,/textContent/);
   assert.doesNotMatch(source,/innerHTML\s*=/);
   const css=await fetch(base+'/style.css');assert.equal(css.status,200);
  });
  await t.test('invite gate, input validation, real registration and duplicate protection',async()=>{
   let a=await request('/api/auth/register',{method:'POST',json:{...reg('pilot'),inviteCode:'wrong'}});assert.equal(a.status,403);
   a=await request('/api/auth/register',{method:'POST',json:reg('pilot','short')});assert.equal(a.status,400);
   a=await request('/api/auth/register',{method:'POST',json:reg('pilot')});assert.equal(a.status,201);
   assert.equal(a.json.world,'u-pilot');
   a=await request('/api/auth/register',{method:'POST',json:reg('pilot')});assert.equal(a.status,409);
   a=await request('/api/auth/register',{method:'POST',json:reg('friend')});assert.equal(a.status,201);
  });
  let first,second,world,postId,draftId;
  await t.test('password auth, HttpOnly session and private account isolation',async()=>{
   let a=await request('/api/auth/me');assert.equal(a.status,401);
   a=await request('/api/auth/login',{method:'POST',json:{email:'pilot@example.net',password:'wrong-password'}});assert.equal(a.status,401);
   first=await login('pilot');second=await login('friend');
   a=await request('/api/auth/me',{cookie:first});
   assert.equal(a.status,200);assert.equal(a.json.user.username,'pilot');
   assert.equal(a.json.worlds.length,1);
   world=a.json.worlds[0].id;
   const another=await request('/api/auth/me',{cookie:second});
   assert.equal(another.json.user.username,'friend');
   assert.notEqual(another.json.worlds[0].id,world);
   assert.equal(another.json.user.role,'member');
  });
  await t.test('owner can create drafts and published posts; other accounts cannot',async()=>{
   let a=await request('/api/posts',{method:'POST',cookie:first,json:{worldId:world,body:'Моя личная заготовка',status:'draft'}});
   assert.equal(a.status,201);draftId=a.json.id;
   a=await request('/api/posts',{method:'POST',cookie:first,json:{worldId:world,body:'Полезная публичная история',status:'published'}});
   assert.equal(a.status,201);postId=a.json.id;
   a=await request('/api/posts');assert.equal(a.status,200);
   assert.equal(a.json.items.length,1);
   assert.equal(a.json.items[0].body,'Полезная публичная история');
   assert.equal(Object.hasOwn(a.json.items[0],'email'),false);
   a=await request('/api/me/posts',{cookie:second});
   assert.equal(a.status,200);assert.equal(a.json.items.length,0);
   a=await request('/api/posts',{method:'POST',cookie:second,json:{worldId:world,body:'Попытка присвоить чужой мир',status:'published'}});
   assert.equal(a.status,403);
   a=await request('/api/posts/'+postId,{method:'PATCH',cookie:second,json:{body:'Подмена'}});assert.equal(a.status,404);
   a=await request('/api/posts/'+postId,{method:'DELETE',cookie:second,json:{}});assert.equal(a.status,404);
   a=await request('/api/me/posts',{cookie:first});assert.equal(a.json.items.length,2);
   a=await request('/api/posts/'+draftId,{method:'PATCH',cookie:first,json:{status:'published'}});
   assert.equal(a.status,200);
   a=await request('/api/posts?limit=1');assert.equal(a.json.items.length,1);assert.ok(a.json.nextCursor);
   const next=await request('/api/posts?limit=1&cursor='+a.json.nextCursor);
   assert.equal(next.json.items.length,1);assert.equal(next.json.nextCursor,null);
  });
  await t.test('same-origin checks, content validation, limits and report privacy',async()=>{
   let a=await request('/api/posts',{method:'POST',cookie:first,origin:'https://attacker.example',json:{worldId:world,body:'Cross-site'}});assert.equal(a.status,403);
   a=await request('/api/posts',{method:'POST',cookie:first,json:{worldId:world,body:'X'.repeat(2001),status:'published'}});assert.equal(a.status,400);
   a=await request('/api/posts?cursor=not-an-id');assert.equal(a.status,400);
   a=await request('/api/posts?limit=9999');assert.equal(a.status,400);
   a=await request('/api/reports',{method:'POST',cookie:first,json:{postId,reason:'spam'}});assert.equal(a.status,403);
   a=await request('/api/reports',{method:'POST',cookie:second,json:{postId,reason:'spam',detail:'Проверить источник'}});
   assert.equal(a.status,201);
   a=await request('/api/reports',{method:'POST',cookie:second,json:{postId,reason:'spam'}});
   assert.equal(a.status,409);
   a=await request('/api/mod/reports',{cookie:second});assert.equal(a.status,403);
   a=await request('/api/mod/posts/'+postId+'/hide',{method:'POST',cookie:second,json:{}});
   assert.equal(a.status,403);
  });
  await t.test('portable export respects owner-only posts and never leaks passwords or session tokens',async()=>{
   const own=await request('/api/account/export',{cookie:first});
   assert.equal(own.status,200);
   assert.equal(own.json.format,'MARCOSA-ACCOUNT-EXPORT-v1');
   assert.equal(own.json.user.username,'pilot');
   assert.equal(own.json.worlds.length,1);
   assert.equal(own.json.posts.length,2);
   assert.ok(own.json.posts.some(x=>x.id===draftId));
   assert.equal(JSON.stringify(own.json).includes('password_hash'),false);
   assert.equal(JSON.stringify(own.json).includes('token_hash'),false);
   const other=await request('/api/account/export',{cookie:second});
   assert.equal(other.status,200);
   assert.equal(other.json.posts.length,0);
   assert.equal(other.json.user.username,'friend');
   const guest=await request('/api/account/export');
   assert.equal(guest.status,401);
  });
  await t.test('moderator cannot be created through public API; protected review and hide works',async()=>{
   const update=app.db.prepare("UPDATE users SET role='moderator' WHERE username='friend'").run();
   assert.equal(update.changes,1);
   const reports=await request('/api/mod/reports',{cookie:second});
   assert.equal(reports.status,200);assert.equal(reports.json.items.length,1);
   const hide=await request('/api/mod/posts/'+postId+'/hide',{method:'POST',cookie:second,json:{}});
   assert.equal(hide.status,200);
   const list=await request('/api/posts');
   assert.ok(!list.json.items.some(x=>x.id===postId),'hidden post cannot appear in public feed');
   const cannotUndo=await request('/api/posts/'+postId,{method:'PATCH',cookie:first,json:{status:'published'}});
   assert.equal(cannotUndo.status,409);
   const reviewed=await request('/api/mod/reports',{cookie:second});
   assert.equal(reviewed.json.items.length,0);
  });
  await t.test('account deletion requires password and cascades posts, worlds and sessions',async()=>{
   let a=await request('/api/account',{method:'DELETE',cookie:first,json:{confirm:'DELETE',password:'wrong'}});assert.equal(a.status,403);
   a=await request('/api/account',{method:'DELETE',cookie:first,json:{confirm:'DELETE',password:'super-secret-passphrase-2026'}});
   assert.equal(a.status,200);assert.equal(a.json.deleted,true);
   a=await request('/api/auth/me',{cookie:first});assert.equal(a.status,401);
   a=await request('/api/posts');assert.equal(a.json.items.length,0);
   a=await request('/api/worlds');assert.ok(!a.json.items.some(x=>x.slug==='u-pilot'));
   a=await request('/api/auth/logout',{method:'POST',cookie:second,json:{}});
   assert.equal(a.status,200);
   a=await request('/api/auth/me',{cookie:second});assert.equal(a.status,401);
  });
 }finally{await app.close();}
});
test('R28 durable SQLite and closed registration default',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r28-'));
 const path=join(dir,'lab.sqlite');
 try{
  const one=createApp({databasePath:path,inviteCode:'my-strong-closed-invite'});
  await new Promise(ok=>one.server.listen(0,'127.0.0.1',ok));
  const host='http://127.0.0.1:'+one.server.address().port;
  const a=await fetch(host+'/api/auth/register',{method:'POST',headers:{origin:host,'content-type':'application/json'},body:JSON.stringify({username:'lasting',email:'lasting@example.net',password:'a-long-password-123456',inviteCode:'my-strong-closed-invite'})});
  assert.equal(a.status,201);
  await one.close();
  const two=createApp({databasePath:path});
  await new Promise(ok=>two.server.listen(0,'127.0.0.1',ok));
  const h2='http://127.0.0.1:'+two.server.address().port;
  const response=await fetch(h2+'/api/worlds');assert.equal((await response.json()).items.length,1);
  const closed=await fetch(h2+'/api/auth/register',{method:'POST',headers:{origin:h2,'content-type':'application/json'},body:JSON.stringify({username:'noinvite',email:'no@example.net',password:'a-long-password-123456',inviteCode:'something'})});
  assert.equal(closed.status,403);
  await two.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('R28 CLI refuses an internet-facing address even when manually requested',()=>{
 const run=spawnSync(process.execPath,['server-lab/server.mjs'],{
  cwd:new URL('../../',import.meta.url),env:{...process.env,HOST:'0.0.0.0',PORT:'0'},
  encoding:'utf8',timeout:5000
 });
 assert.equal(run.status,1);
 assert.match(run.stderr,/Refusing external network bind/);
});
