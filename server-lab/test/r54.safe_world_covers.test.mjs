import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {sanitizePngCover,MAX_COVER_BYTES} from '../media/safe-png.mjs';

const sig=Buffer.from([137,80,78,71,13,10,26,10]);
function crc(b){
 let c=0xffffffff;
 for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c&1)?((c>>>1)^0xedb88320):(c>>>1);}
 return (c^0xffffffff)>>>0;
}
function chunk(type,body){
 const tag=Buffer.from(type,'ascii'),bytes=Buffer.alloc(12+body.length);
 bytes.writeUInt32BE(body.length,0);tag.copy(bytes,4);body.copy(bytes,8);
 bytes.writeUInt32BE(crc(bytes.subarray(4,bytes.length-4)),bytes.length-4);
 return bytes;
}
function png(width=2,height=2,{metadata=false,animated=false,badFilter=false}={}){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 const row=Buffer.alloc(1+width*4);
 if(badFilter)row[0]=5;
 for(let p=1;p<row.length;p+=4){row[p]=19;row[p+1]=51;row[p+2]=83;row[p+3]=255;}
 const blocks=[sig,chunk('IHDR',ihdr)];
 if(metadata)blocks.push(chunk('tEXt',Buffer.from('Comment\x00private-GPS-token')));
 if(animated)blocks.push(chunk('acTL',Buffer.from([0,0,0,1,0,0,0,0])));
 blocks.push(chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:height},()=>row)))));
 blocks.push(chunk('IEND',Buffer.alloc(0)));
 return Buffer.concat(blocks);
}
test('R54: strict PNG canonicalizer discards all metadata and bounds memory',()=>{
 const original=png(3,2,{metadata:true});
 assert.ok(original.includes(Buffer.from('private-GPS-token')));
 const clean=sanitizePngCover(original);
 assert.equal(clean.width,3);assert.equal(clean.height,2);
 assert.ok(clean.png.subarray(0,8).equals(sig));
 assert.ok(!clean.png.includes(Buffer.from('private-GPS-token')));
 assert.equal(clean.png.includes(Buffer.from('tEXt')),false);
 assert.deepEqual(sanitizePngCover(clean.png).png,clean.png);
 const invalid=[
  Buffer.from('%PDF-not-an-image'),Buffer.alloc(MAX_COVER_BYTES+1),
  png(1601,1),png(1300,1300),png(2,2,{animated:true}),
  png(2,2,{badFilter:true})
 ];
 const corrupt=Buffer.from(png());corrupt[29]^=3;invalid.push(corrupt);
 for(const value of invalid)
  assert.throws(()=>sanitizePngCover(value),/INVALID_PNG_COVER/);
});

test('R54: owner-only real PNG upload, public sanitized cover, replace, blocked visitor, delete and restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r54-cover-'));
 const dbPath=join(dir,'cover.sqlite');const invite='r54-local-invitation-key';
 const password='r54-long-safe-password-2026';
 let lab=null,base='';
 async function boot(){
  lab=createApp({databasePath:dbPath,inviteCode:invite});
  await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
  base='http://127.0.0.1:'+lab.server.address().port;
 }
 async function req(path,{method='GET',cookie,body,type='application/json',origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers['Content-Type']=type;headers.Origin=origin;}
  const data=body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body);
  const r=await fetch(base+'/api'+path,{method,headers,...(data===undefined?{}:{body:data})});
  const contentType=r.headers.get('content-type')||'';
  return{status:r.status,response:r,data:contentType.startsWith('image/png')
   ?Buffer.from(await r.arrayBuffer()):await r.json()};
 }
 async function person(username){
  const email=username+'@example.net';
  let r=await req('/auth/register',{method:'POST',body:{username,email,password,inviteCode:invite}});
  assert.equal(r.status,201);
  r=await req('/auth/login',{method:'POST',body:{email,password}});
  assert.equal(r.status,200);
  const cookie=r.response.headers.get('set-cookie').split(';')[0];
  r=await req('/auth/me',{cookie});assert.equal(r.status,200);
  return {cookie,world:r.data.worlds[0]};
 }
 try{
  await boot();
  const owner=await person('owner54'),stranger=await person('stranger54'),moderator=await person('moderator54');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username='moderator54'").run();
  const url='/worlds/'+owner.world.slug+'/cover';
  let r=await req(url);
  assert.equal(r.status,404,'empty World must not fabricate a cover');
  const photo=png(3,2,{metadata:true});
  r=await req(url,{method:'POST',body:photo,type:'image/png'});
  assert.equal(r.status,401,'guest upload forbidden');
  r=await req(url,{method:'POST',body:photo,type:'image/png',cookie:stranger.cookie});
  assert.equal(r.status,404,'other owner cannot upload to чужой World');
  r=await req(url,{method:'POST',body:photo,type:'image/png',cookie:owner.cookie,origin:'https://unauthorized.example.net'});
  assert.equal(r.status,403,'cross-origin upload forbidden');
  r=await req(url,{method:'POST',body:photo,type:'application/octet-stream',cookie:owner.cookie});
  assert.equal(r.status,415,'mime cannot be generic');
  r=await req(url,{method:'POST',body:Buffer.from('<svg></svg>'),type:'image/png',cookie:owner.cookie});
  assert.equal(r.status,422,'server checks actual PNG bytes');
  r=await req(url,{method:'POST',body:png(1601,1),type:'image/png',cookie:owner.cookie});
  assert.equal(r.status,422,'huge dimensions forbidden');
  r=await req(url,{method:'POST',body:photo,type:'image/png',cookie:owner.cookie});
  assert.equal(r.status,200);
  assert.equal(r.data.metadataRemoved,true);
  assert.equal(r.data.width,3);
  assert.equal(r.data.reviewStatus,'pending');
  r=await req(url);
  assert.equal(r.status,404,'unreviewed World cover is never public');
  r=await req('/me'+url,{cookie:owner.cookie});
  assert.equal(r.status,200,'owner can inspect pending normalized PNG');
  let decision=await req('/mod'+url+'/review',{cookie:moderator.cookie,method:'POST',body:{decision:'approved'}});
  assert.equal(decision.status,200,'independent moderator publishes verified PNG');
  r=await req(url);
  assert.equal(r.status,200);
  assert.equal(r.response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(r.response.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.equal(r.response.headers.get('content-type'),'image/png');
  assert.ok(!r.data.includes(Buffer.from('private-GPS-token')));
  assert.equal(sanitizePngCover(r.data).width,3);
  r=await req('/worlds');
  assert.equal(r.status,200);
  assert.equal(r.data.items.find(x=>x.slug===owner.world.slug)?.hasCover,1);
  r=await req('/auth/me',{cookie:owner.cookie});
  assert.equal(r.data.worlds[0].hasCover,1);
  assert.equal(r.data.worlds[0].coverStatus,'approved');
  r=await req('/account/export',{cookie:owner.cookie});
  assert.equal(r.data.worldCoverMetadata.length,1);
  assert.equal(r.data.worldCoverMetadata[0].width,3);
  assert.doesNotMatch(JSON.stringify(r.data),/private-GPS-token|password_hash/);
  r=await req(url,{method:'POST',body:png(5,4),type:'image/png',cookie:owner.cookie});
  assert.equal(r.status,200);assert.equal(r.data.width,5);
  r=await req(url);
  assert.equal(r.status,404,'replacement withdraws previous public approval');
  decision=await req('/mod'+url+'/review',{cookie:moderator.cookie,method:'POST',body:{decision:'approved'}});
  assert.equal(decision.status,200);
  r=await req(url);
  assert.equal(r.status,200);
  assert.equal(sanitizePngCover(r.data).width,5);
  r=await req('/users/owner54/block',{method:'POST',cookie:stranger.cookie,body:{}});
  assert.equal(r.status,201);
  r=await req(url,{cookie:stranger.cookie});
  assert.equal(r.status,404,'blocking applies to signed-in visitor');
  r=await req(url);
  assert.equal(r.status,200,'public guest content remains available');
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await lab.close();lab=null;
  await boot();
  r=await req(url);
  assert.equal(r.status,200,'stored image survives real SQLite restart');
  r=await req('/auth/login',{method:'POST',body:{email:'owner54@example.net',password}});
  const freshCookie=r.response.headers.get('set-cookie').split(';')[0];
  r=await req(url,{method:'DELETE',cookie:freshCookie,body:{}});
  assert.equal(r.status,200);assert.equal(r.data.removed,true);
  r=await req(url);assert.equal(r.status,404);
  r=await req(url,{method:'POST',cookie:freshCookie,type:'image/png',body:png(2,2)});
  assert.equal(r.status,200);
  r=await req('/account',{method:'DELETE',cookie:freshCookie,body:{confirm:'DELETE',password}});
  assert.equal(r.status,200);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_covers').get().n,0);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{
  if(lab)await lab.close();
  rmSync(dir,{recursive:true,force:true});
 }
});
