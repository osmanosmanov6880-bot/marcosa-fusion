import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createApp} from '../server.mjs';

function crc(b){let v=0xffffffff;for(const x of b){v^=x;for(let k=0;k<8;k++)v=(v&1)?((v>>>1)^0xedb88320):(v>>>1);}return(v^0xffffffff)>>>0;}
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length,0);b.write(type,4,'ascii');data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,b.length-4)),b.length-4);return b;}
function png(n=3){
 const ih=Buffer.alloc(13);ih.writeUInt32BE(n,0);ih.writeUInt32BE(2,4);ih[8]=8;ih[9]=6;
 const row=Buffer.alloc(1+4*n);for(let i=1;i<row.length;i+=4){row[i]=25;row[i+1]=80;row[i+2]=121;row[i+3]=255;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);
}
test('R59 independent cover appeals: private owner and moderator, no auto-publish, appeal stale protection and deletion',async()=>{
 const lab=createApp({inviteCode:'r59-long-test-invite'});
 await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+lab.server.address().port;
 const password='r59-safe-password-at-least-12';
 async function req(path,{method='GET',cookie,data,type='application/json',origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']=type;}
  const raw=data===undefined?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data);
  const r=await fetch(base+'/api'+path,{method,headers,...(raw===undefined?{}:{body:raw})});
  const content=(r.headers.get('content-type')||'').includes('image/png')?Buffer.from(await r.arrayBuffer()):await r.json();
  return{status:r.status,data:content,cookie:r.headers.get('set-cookie')};
 }
 async function member(username){
  let r=await req('/auth/register',{method:'POST',data:{username,email:username+'@example.net',password,inviteCode:'r59-long-test-invite'}});
  assert.equal(r.status,201,'register '+username);
  r=await req('/auth/login',{method:'POST',data:{email:username+'@example.net',password}});
  assert.equal(r.status,200);const cookie=r.cookie.split(';')[0];
  r=await req('/auth/me',{cookie});assert.equal(r.status,200);
  return{cookie,world:r.data.worlds[0]};
 }
 try{
  const owner=await member('owner59'),first=await member('first59'),second=await member('second59'),outsider=await member('outsider59');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username IN ('first59','second59')").run();
  const slug=owner.world.slug,cover='/worlds/'+slug+'/cover';
  let r=await req('/me/cover-appeals');assert.equal(r.status,401);
  r=await req('/mod/cover-appeals',{cookie:owner.cookie});assert.equal(r.status,403);
  r=await req('/me/cover-appeals',{cookie:owner.cookie});assert.deepEqual(r.data.items,[]);
  r=await req('/me/cover-appeals',{cookie:outsider.cookie});assert.deepEqual(r.data.items,[]);
  r=await req('/me/cover-appeals',{cookie:owner.cookie,method:'POST',data:{slug,reason:'This original art is mine'}});
  assert.equal(r.status,404,'appeals require actual rejected image');
  r=await req(cover,{method:'POST',cookie:owner.cookie,data:png(),type:'image/png'});
  assert.equal(r.status,200);assert.equal(r.data.reviewStatus,'pending');
  r=await req('/mod'+cover+'/review',{method:'POST',cookie:first.cookie,data:{decision:'rejected'}});
  assert.equal(r.status,200);
  r=await req(cover);assert.equal(r.status,404);
  r=await req('/me/cover-appeals',{cookie:outsider.cookie,method:'POST',data:{slug,reason:'I am not the owner of this World'}});
  assert.equal(r.status,404);
  for(const bad of [{slug,reason:'Too short'},{slug,reason:12},{slug,reason:'s'.repeat(1001)},{slug,reason:'Reason is sufficiently long',owner_id:'spoof'}]){
   r=await req('/me/cover-appeals',{cookie:owner.cookie,method:'POST',data:bad});
   assert.equal(r.status,400);
  }
  r=await req('/me/cover-appeals',{cookie:owner.cookie,method:'POST',origin:'https://attacker.example.net',data:{slug,reason:'This is my original photograph'}});assert.equal(r.status,403);
  const reason='This is my original photographic work, not an unlicensed image';
  r=await req('/me/cover-appeals',{cookie:owner.cookie,method:'POST',data:{slug,reason}});
  assert.equal(r.status,201);
  const appealId=r.data.id;
  r=await req('/me/cover-appeals',{cookie:owner.cookie,method:'POST',data:{slug,reason}});assert.equal(r.status,409);
  const own=await req('/me/cover-appeals',{cookie:owner.cookie});
  assert.equal(own.status,200);assert.equal(own.data.items.length,1);assert.equal(own.data.items[0].reason,reason);
  const other=await req('/me/cover-appeals',{cookie:outsider.cookie});
  assert.deepEqual(other.data.items,[]);
  r=await req('/mod/cover-appeals',{cookie:first.cookie});
  assert.equal(r.status,200);assert.deepEqual(r.data.items,[],'original rejector must not see their own appeal');
  r=await req('/mod/cover-appeals',{cookie:second.cookie});
  assert.equal(r.status,200);assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].id,appealId);
  assert.doesNotMatch(JSON.stringify(r.data),/png|password|hash|cookie|salt/i);
  for(const [cookie,status] of [[owner.cookie,403],[first.cookie,403],[outsider.cookie,403]]){
   r=await req('/mod/cover-appeals/'+appealId+'/resolve',{cookie,method:'POST',data:{decision:'reopened'}});
   assert.equal(r.status,status);
  }
  r=await req('/mod/cover-appeals/'+appealId+'/resolve',{cookie:second.cookie,method:'POST',data:{decision:'bad'}});
  assert.equal(r.status,400);
  r=await req('/mod/cover-appeals/'+appealId+'/resolve',{cookie:second.cookie,method:'POST',origin:'https://attacker.example.net',data:{decision:'reopened'}});
  assert.equal(r.status,403);
  // The appeal is bound to the exact normalized image digest; direct storage
  // tampering cannot authorize its replacement.
  const persisted=lab.db.prepare('SELECT png FROM world_covers WHERE world_id=?').get(owner.world.id);
  lab.db.prepare('UPDATE world_covers SET png=? WHERE world_id=?').run(png(6),owner.world.id);
  r=await req('/mod/cover-appeals/'+appealId+'/resolve',{cookie:second.cookie,method:'POST',data:{decision:'reopened'}});
  assert.equal(r.status,409,'digest mismatch must block stale appeal');
  lab.db.prepare('UPDATE world_covers SET png=? WHERE world_id=?').run(persisted.png,owner.world.id);
  r=await req('/mod/cover-appeals/'+appealId+'/resolve',{cookie:second.cookie,method:'POST',data:{decision:'reopened'}});
  assert.equal(r.status,200);assert.equal(r.data.publicVisible,false);
  assert.equal(r.data.nextReviewRequired,true);
  assert.equal(lab.db.prepare('SELECT review_status FROM world_covers WHERE world_id=?').get(owner.world.id).review_status,'pending');
  r=await req(cover);assert.equal(r.status,404,'successful appeal must not auto-publish');
  r=await req('/mod/cover-appeals/'+appealId+'/resolve',{cookie:second.cookie,method:'POST',data:{decision:'upheld'}});assert.equal(r.status,404);
  r=await req('/mod/cover-queue',{cookie:first.cookie});
  assert.equal(r.status,200);assert.deepEqual(r.data.items,[],'original reviewer excluded from new queue');
  r=await req('/mod'+cover,{cookie:first.cookie});
  assert.equal(r.status,404,'original reviewer cannot preview reopened image');
  r=await req('/mod'+cover+'/review',{cookie:first.cookie,method:'POST',data:{decision:'approved'}});
  assert.equal(r.status,403,'original rejection reviewer cannot approve reopened image');
  r=await req('/mod'+cover+'/review',{cookie:second.cookie,method:'POST',data:{decision:'approved'}});
  assert.equal(r.status,200,'different reviewer can approve normalized image after second review');
  r=await req(cover);assert.equal(r.status,200,'image public only after separate image approval');
  // Fresh image is rejected again, and its new appeal may be upheld.
  r=await req(cover,{method:'POST',cookie:owner.cookie,data:png(4),type:'image/png'});assert.equal(r.status,200);
  r=await req('/mod'+cover+'/review',{cookie:first.cookie,method:'POST',data:{decision:'rejected'}});assert.equal(r.status,200);
  r=await req('/me/cover-appeals',{cookie:owner.cookie,method:'POST',data:{slug,reason:'This photograph is correctly licensed to the author'}});assert.equal(r.status,201);
  const secondId=r.data.id;
  r=await req('/mod/cover-appeals/'+secondId+'/resolve',{cookie:second.cookie,method:'POST',data:{decision:'upheld'}});assert.equal(r.status,200);
  assert.equal(lab.db.prepare('SELECT review_status FROM world_covers WHERE world_id=?').get(owner.world.id).review_status,'rejected');
  r=await req(cover);assert.equal(r.status,404);
  // A third appeal becomes stale and is atomically withdrawn on replacement.
  r=await req('/me/cover-appeals',{cookie:owner.cookie,method:'POST',data:{slug,reason:'I wish to submit a revised version for review'}});assert.equal(r.status,201);
  const withdrawnId=r.data.id;
  r=await req(cover,{method:'POST',cookie:owner.cookie,data:png(5),type:'image/png'});assert.equal(r.status,200);
  r=await req('/mod/cover-appeals/'+withdrawnId+'/resolve',{cookie:second.cookie,method:'POST',data:{decision:'reopened'}});
  assert.equal(r.status,404);
  r=await req('/me/cover-appeals',{cookie:owner.cookie});
  assert.deepEqual(r.data.items.map(x=>x.status),['withdrawn','upheld','reopened']);
  const exported=await req('/account/export',{cookie:owner.cookie});
  assert.equal(exported.status,200);assert.equal(exported.data.coverAppeals.length,3);
  assert.doesNotMatch(JSON.stringify(exported.data),/password_hash|token_hash/);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  const deleted=await req('/account',{cookie:owner.cookie,method:'DELETE',data:{confirm:'DELETE',password}});
  assert.equal(deleted.status,200);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_appeals').get().n,0);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await lab.close();}
});
