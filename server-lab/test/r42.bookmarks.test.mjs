import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('R42: private saved stories, duplicate-safe writes, pagination, blocks, moderation and deletion',async()=>{
 const app=createApp({inviteCode:'r42-private-bookmark-code'});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+app.server.address().port;
 const password='r42-private-safe-password';
 async function req(path,{cookie,method='GET',data,origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const res=await fetch(base+'/api'+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
  return{status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
 }
 async function member(username){
  const email=username+'@example.net';
  let r=await req('/auth/register',{method:'POST',data:{username,email,password,inviteCode:'r42-private-bookmark-code'}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',data:{email,password}});
  assert.equal(r.status,200);
  const cookie=r.cookie.split(';')[0];
  const me=await req('/auth/me',{cookie});
  return{cookie,world:me.data.worlds[0],id:me.data.user.id,username};
 }
 async function post(owner,body,status='published'){
  const r=await req('/posts',{cookie:owner.cookie,method:'POST',data:{worldId:owner.world.id,body,status}});
  assert.equal(r.status,201);return r.data.id;
 }
 try{
  const alice=await member('alice42'),bob=await member('bob42'),carol=await member('carol42');
  const first=await post(alice,'This story should be privately bookmarked');
  const draft=await post(alice,'An unpublished secret draft','draft');
  let r=await req('/me/saved');assert.equal(r.status,401);
  r=await req('/me/saved/ids');assert.equal(r.status,401);
  r=await req('/posts/'+first+'/save',{method:'POST',data:{}});assert.equal(r.status,401);
  r=await req('/posts/'+first+'/save',{cookie:bob.cookie,method:'POST',origin:'https://evil.example.org',data:{}});
  assert.equal(r.status,403);
  r=await req('/posts/'+draft+'/save',{cookie:bob.cookie,method:'POST',data:{}});
  assert.equal(r.status,404,'draft may not be saved');
  r=await req('/posts/'+first+'/save',{cookie:bob.cookie,method:'POST',data:{}});
  assert.equal(r.status,201);assert.equal(r.data.saved,true);assert.equal(r.data.changed,true);
  r=await req('/posts/'+first+'/save',{cookie:bob.cookie,method:'POST',data:{}});
  assert.equal(r.status,200);assert.equal(r.data.changed,false);
  r=await req('/me/saved',{cookie:bob.cookie});
  assert.equal(r.status,200);assert.equal(r.data.items.length,1);
  assert.equal(r.data.items[0].id,first);
  assert.equal(r.data.items[0].username,'alice42');
  assert.equal(r.data.nextCursor,null);
  r=await req('/me/saved',{cookie:carol.cookie});assert.deepEqual(r.data.items,[]);
  r=await req('/me/saved',{cookie:alice.cookie});assert.deepEqual(r.data.items,[]);
  r=await req('/me/saved/ids',{cookie:bob.cookie});
  assert.deepEqual(r.data.ids,[first]);assert.equal(r.data.isPublic,false);
  assert.doesNotMatch(JSON.stringify(r.data),/password|token_hash|email|salt/);
  const pages=[];
  for(let i=0;i<22;i++){
   const id=await post(alice,'Published story '+String(i));
   pages.push(id);
   r=await req('/posts/'+id+'/save',{cookie:bob.cookie,method:'POST',data:{}});
   assert.equal(r.status,201);
  }
  r=await req('/me/saved',{cookie:bob.cookie});
  assert.equal(r.data.items.length,20);assert.match(r.data.nextCursor,/^[0-9]+$/);
  const earliest=r.data.items.at(-1).cursorId;
  assert.equal(r.data.nextCursor,String(earliest));
  let next=await req('/me/saved?cursor='+r.data.nextCursor,{cookie:bob.cookie});
  assert.equal(next.status,200);assert.equal(next.data.items.length,3);
  assert.equal(next.data.nextCursor,null);
  assert.equal(new Set([...r.data.items,...next.data.items].map(x=>x.id)).size,23);
  r=await req('/me/saved?cursor=malicious',{cookie:bob.cookie});assert.equal(r.status,400);
  r=await req('/me/saved?cursor=-1',{cookie:bob.cookie});assert.equal(r.status,400);
  const exported=await req('/account/export',{cookie:bob.cookie});
  assert.equal(exported.status,200);assert.equal(exported.data.savedPosts.length,23);
  assert.ok(!JSON.stringify(exported.data).includes('password_hash'));
  r=await req('/users/bob42/block',{cookie:alice.cookie,method:'POST',data:{}});
  assert.equal(r.status,201);
  r=await req('/me/saved',{cookie:bob.cookie});
  assert.equal(r.data.items.length,0,'blocked author disappears from saved library');
  r=await req('/posts/'+first+'/save',{cookie:bob.cookie,method:'DELETE',data:{}});
  assert.equal(r.status,200);assert.equal(r.data.saved,false);
  r=await req('/posts/'+first+'/save',{cookie:bob.cookie,method:'POST',data:{}});
  assert.equal(r.status,403,'blocked author cannot be newly bookmarked');
  r=await req('/users/bob42/block',{cookie:alice.cookie,method:'DELETE',data:{}});
  assert.equal(r.status,200);
  r=await req('/me/saved',{cookie:bob.cookie});assert.equal(r.data.items.length,20);
  r=await req('/me/saved/ids',{cookie:bob.cookie});
  assert.equal(r.data.ids.length,22);assert.ok(!r.data.ids.includes(first));
  // Real independent moderator hides a public post: bookmark remains private
  // but unavailable for viewing until the author is restored by due process.
  app.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(carol.id);
  r=await req('/mod/posts/'+pages.at(-1)+'/hide',{cookie:carol.cookie,method:'POST',data:{}});
  assert.equal(r.status,200);
  r=await req('/me/saved',{cookie:bob.cookie});
  assert.ok(r.data.items.every(x=>x.id!==pages.at(-1)));
  r=await req('/posts/'+pages.at(-1)+'/save',{cookie:bob.cookie,method:'DELETE',data:{}});
  assert.equal(r.status,200,'hidden bookmark remains deletable');
  r=await req('/posts/'+pages.at(-1)+'/save',{cookie:bob.cookie,method:'POST',data:{}});
  assert.equal(r.status,404);
  // Deleting published content removes all saved references through SQLite FK.
  r=await req('/posts/'+pages[0],{cookie:alice.cookie,method:'DELETE',data:{}});
  assert.equal(r.status,200);
  r=await req('/me/saved/ids',{cookie:bob.cookie});
  assert.equal(r.data.ids.length,20);assert.ok(!r.data.ids.includes(pages[0]));
  r=await req('/account',{cookie:bob.cookie,method:'DELETE',data:{confirm:'DELETE',password}});
  assert.equal(r.status,200);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM saved_posts').get().n,0);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
