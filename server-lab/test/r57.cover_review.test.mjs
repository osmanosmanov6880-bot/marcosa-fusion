import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createApp} from '../server.mjs';

function crc(bytes){
 let value=0xffffffff;
 for(const b of bytes){value^=b;for(let k=0;k<8;k++)value=(value&1)?(value>>>1)^0xedb88320:(value>>>1);}
 return (value^0xffffffff)>>>0;
}
function chunk(name,data){
 const result=Buffer.alloc(data.length+12);
 result.writeUInt32BE(data.length,0);result.write(name,4,'ascii');data.copy(result,8);
 result.writeUInt32BE(crc(result.subarray(4,result.length-4)),result.length-4);
 return result;
}
function fixture(){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=6;
 const row=Buffer.from([0,19,55,95,255,33,69,101,255]);
 return Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',ihdr),
  chunk('IDAT',deflateSync(Buffer.concat([row,row]))),
  chunk('IEND',Buffer.alloc(0))
 ]);
}
test('R57: unreviewed media is private; independent moderator approves and rejection removes public view',async()=>{
 const lab=createApp({inviteCode:'r57-pilot-media-invite'});
 await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+lab.server.address().port;
 const password='r57-secure-long-password';
 async function req(path,{method='GET',cookie,data,mime='application/json',origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']=mime;}
  const body=data===undefined?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data);
  const r=await fetch(base+'/api'+path,{method,headers,...(body===undefined?{}:{body})});
  const isPng=(r.headers.get('content-type')||'').includes('image/png');
  return{status:r.status,data:isPng?Buffer.from(await r.arrayBuffer()):await r.json(),headers:r.headers,cookie:r.headers.get('set-cookie')};
 }
 async function create(username){
  const email=username+'@example.net';
  let a=await req('/auth/register',{method:'POST',data:{username,email,password,inviteCode:'r57-pilot-media-invite'}});
  assert.equal(a.status,201);
  a=await req('/auth/login',{method:'POST',data:{email,password}});
  assert.equal(a.status,200);
  const cookie=a.cookie.split(';')[0];
  a=await req('/auth/me',{cookie});
  return{cookie,world:a.data.worlds[0],username};
 }
 try{
  const alice=await create('alice57'),bob=await create('bob57'),moderator=await create('reviewer57');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username='reviewer57'").run();
  const image=fixture(),url='/worlds/'+alice.world.slug+'/cover';
  let r=await req(url,{method:'POST',cookie:alice.cookie,mime:'image/png',data:image});
  assert.equal(r.status,200);assert.equal(r.data.reviewStatus,'pending');assert.equal(r.data.publicVisible,false);
  r=await req(url);assert.equal(r.status,404,'private until moderated');
  r=await req('/worlds/'+alice.world.slug);
  assert.equal(r.data.world.hasCover,0,'public metadata does not leak pending media');
  r=await req('/auth/me',{cookie:alice.cookie});
  assert.equal(r.data.worlds[0].hasCover,1);assert.equal(r.data.worlds[0].coverStatus,'pending');
  r=await req('/me'+url,{cookie:alice.cookie});
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
  r=await req('/me'+url,{cookie:bob.cookie});assert.equal(r.status,404);
  r=await req('/mod/cover-queue');assert.equal(r.status,401);
  r=await req('/mod/cover-queue',{cookie:bob.cookie});assert.equal(r.status,403);
  r=await req('/mod/cover-queue',{cookie:moderator.cookie});
  assert.equal(r.status,200);assert.deepEqual(r.data.items.map(x=>x.slug),[alice.world.slug]);
  assert.doesNotMatch(JSON.stringify(r.data),/password|token_hash|png|salt/);
  r=await req('/mod'+url,{cookie:moderator.cookie});assert.equal(r.status,200);
  r=await req('/mod'+url,{cookie:bob.cookie});assert.equal(r.status,403);
  r=await req('/mod'+url+'/review',{method:'POST',cookie:alice.cookie,data:{decision:'approved'}});
  assert.equal(r.status,403,'self owner not a moderator');
  r=await req('/mod'+url+'/review',{method:'POST',cookie:bob.cookie,data:{decision:'approved'}});
  assert.equal(r.status,403);
  r=await req('/mod'+url+'/review',{method:'POST',cookie:moderator.cookie,data:{decision:'invalid'}});
  assert.equal(r.status,400);
  r=await req('/mod'+url+'/review',{method:'POST',cookie:moderator.cookie,origin:'https://attacker.example.org',data:{decision:'approved'}});
  assert.equal(r.status,403);
  r=await req('/mod'+url+'/review',{method:'POST',cookie:moderator.cookie,data:{decision:'approved'}});
  assert.equal(r.status,200);assert.equal(r.data.publicVisible,true);
  r=await req('/mod'+url+'/review',{method:'POST',cookie:moderator.cookie,data:{decision:'approved'}});
  assert.equal(r.status,404,'can't review a consumed pending decision');
  r=await req(url);assert.equal(r.status,200);
  lab.db.prepare("UPDATE users SET role='member' WHERE username='reviewer57'").run();
  r=await req(url);assert.equal(r.status,404,'revoked reviewer cannot keep public image live');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username='reviewer57'").run();
  r=await req(url);assert.equal(r.status,200,'only active independent moderator approval is public');
  r=await req('/worlds/'+alice.world.slug);
  assert.equal(r.data.world.hasCover,1);
  r=await req(url,{method:'POST',cookie:alice.cookie,mime:'image/png',data:image});
  assert.equal(r.status,200);assert.equal(r.data.reviewStatus,'pending');
  r=await req(url);assert.equal(r.status,404,'reupload immediately withdraws old approval');
  r=await req('/mod'+url+'/review',{method:'POST',cookie:moderator.cookie,data:{decision:'rejected'}});
  assert.equal(r.status,200);assert.equal(r.data.publicVisible,false);
  r=await req(url);assert.equal(r.status,404);
  r=await req('/me'+url,{cookie:alice.cookie});assert.equal(r.status,200,'owner can see rejected cover');
  r=await req('/mod/cover-queue',{cookie:moderator.cookie});
  assert.equal(r.data.items.length,0);
  r=await req('/account/export',{cookie:alice.cookie});
  assert.equal(r.data.worldCoverMetadata.length,1);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_review_audit').get().n,2);
  assert.deepEqual(lab.db.prepare('SELECT decision FROM world_cover_review_audit ORDER BY id').all().map(x=>x.decision),['approved','rejected']);
  r=await req('/worlds/'+moderator.world.slug+'/cover',{method:'POST',cookie:moderator.cookie,mime:'image/png',data:image});
  assert.equal(r.status,200);
  r=await req('/mod/cover-queue',{cookie:moderator.cookie});
  assert.equal(r.data.items.length,0,'reviewer cannot see or approve their own pending World');
  r=await req('/mod/worlds/'+moderator.world.slug+'/cover/review',{method:'POST',cookie:moderator.cookie,data:{decision:'approved'}});
  assert.equal(r.status,403);
  r=await req('/account',{method:'DELETE',cookie:alice.cookie,data:{confirm:'DELETE',password}});
  assert.equal(r.status,200);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_review_audit').get().n,0);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_covers').get().n,1,'other World unaffected');
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await lab.close();}
});
