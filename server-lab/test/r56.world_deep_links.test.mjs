import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';

test('R56: deep World links beyond catalog page, private owner blocking and fresh server metadata',async()=>{
 const app=createApp({inviteCode:'r56-local-invite-only'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port,password='r56-secure-long-password';
 async function req(path,{method='GET',cookie,json}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const r=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 async function person(username){
  const email=username+'@example.net';
  let x=await req('/auth/register',{method:'POST',json:{email,username,password,inviteCode:'r56-local-invite-only'}});
  assert.equal(x.status,201);
  x=await req('/auth/login',{method:'POST',json:{email,password}});
  assert.equal(x.status,200);
  const cookie=x.cookie.split(';')[0];
  x=await req('/auth/me',{cookie});
  assert.equal(x.status,200);
  return{cookie,world:x.data.worlds[0],username};
 }
 try{
  const alice=await person('alice56'),bob=await person('bob56');
  let detail=await req('/worlds/'+alice.world.slug);
  assert.equal(detail.status,200);
  assert.equal(detail.data.world.owner,'alice56');
  assert.equal(detail.data.world.category,'general');
  assert.equal(detail.data.world.hasCover,0);
  assert.doesNotMatch(JSON.stringify(detail.data),/email|password|hash|salt|session/);
  const later=Date.now()+1000000;
  const add=app.db.prepare("INSERT INTO worlds(id,owner_id,slug,title,description,category,created_at) VALUES(?,?,?,?,?,?,?)");
  for(let n=0;n<36;n++)add.run(randomUUID(),alice.world.id?app.db.prepare('SELECT owner_id FROM worlds WHERE id=?').get(alice.world.id).owner_id:alice.world.id,
   'archive-volume-'+String(n).padStart(2,'0'),'Travel archive '+n,'An independent archived travel world','travel',later+n);
  const catalog=await req('/worlds');
  assert.equal(catalog.status,200);
  assert.equal(catalog.data.items.length,30);
  assert.equal(catalog.data.items.some(x=>x.slug===alice.world.slug),false,'old world excluded by top30');
  detail=await req('/worlds/'+alice.world.slug);
  assert.equal(detail.status,200,'canonical endpoint still resolves World not in limited catalog');
  assert.equal(detail.data.world.slug,alice.world.slug);
  assert.equal(detail.data.world.posts_count,0);
  detail=await req('/worlds/archive-volume-00');
  assert.equal(detail.status,200);
  assert.equal(detail.data.world.category,'travel');
  let r=await req('/worlds/'+alice.world.slug,{method:'PATCH',cookie:alice.cookie,json:{title:'Updated art studio',category:'art'}});
  assert.equal(r.status,200);
  detail=await req('/worlds/'+alice.world.slug);
  assert.equal(detail.data.world.title,'Updated art studio','URL lookup must refresh actual server data');
  assert.equal(detail.data.world.category,'art');
  r=await req('/worlds/'+alice.world.slug,{cookie:bob.cookie});
  assert.equal(r.status,200,'public World visible before block');
  r=await req('/users/alice56/block',{method:'POST',cookie:bob.cookie,json:{}});
  assert.equal(r.status,201);
  r=await req('/worlds/'+alice.world.slug,{cookie:bob.cookie});
  assert.equal(r.status,404,'owner block prevents authenticated discovery and direct permalink access');
  r=await req('/worlds/'+alice.world.slug);
  assert.equal(r.status,200,'anonymous public browsing remains allowed');
  r=await req('/worlds/not-a-valid-!slug');assert.equal(r.status,404);
  r=await req('/worlds/archive-volume-00',{cookie:bob.cookie});
  assert.equal(r.status,404,'blocks apply to all Worlds even when not in first 30');
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
