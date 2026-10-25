import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createApp} from '../server.mjs';

function crc(buf){let n=0xffffffff;for(const v of buf){n^=v;for(let k=0;k<8;k++)n=(n&1)?(n>>>1)^0xedb88320:(n>>>1);}return(n^0xffffffff)>>>0;}
function chunk(name,payload){const b=Buffer.alloc(12+payload.length);b.writeUInt32BE(payload.length,0);b.write(name,4,'ascii');payload.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,b.length-4)),b.length-4);return b;}
function png(seed){
 const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=6;
 const row=Buffer.from([0,seed,39,77,255,29,63,83,255]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);
}
const sha=value=>createHash('sha256').update(value).digest('hex');

test('R74 real owner rights declaration: no silent consent, normalized PNG binding, independent review and data deletion',async()=>{
 const lab=createApp({inviteCode:'r74-image-rights-acceptance'});
 await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+lab.server.address().port,pass='strong-r74-local-test-password';
 async function req(path,{method='GET',cookie,data,mime='application/json',rights=null,origin=base}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']=mime;}
  if(rights!==null)headers['X-Marcosa-Rights-Attestation']=rights;
  const body=data===undefined?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data);
  const res=await fetch(base+'/api'+path,{method,headers,...(body===undefined?{}:{body})});
  const contentType=res.headers.get('content-type')||'';
  return{status:res.status,data:contentType.includes('image/png')?Buffer.from(await res.arrayBuffer()):await res.json()};
 }
 async function member(name){
  const email=name+'@example.net';
  let q=await req('/auth/register',{method:'POST',data:{username:name,email,password:pass,inviteCode:'r74-image-rights-acceptance'}});
  assert.equal(q.status,201);
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  q=await req('/auth/me',{cookie});assert.equal(q.status,200);
  return{cookie,world:q.data.worlds[0],name};
 }
 try{
  const owner=await member('artist74'),stranger=await member('stranger74'),mod=await member('mod74');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username='mod74'").run();
  const path='/worlds/'+owner.world.slug+'/cover';
  let r=await req(path,{method:'POST',data:png(13),mime:'image/png'});
  assert.equal(r.status,401,'Guests cannot declare someone else rights');
  r=await req(path,{method:'POST',cookie:stranger.cookie,data:png(13),mime:'image/png',rights:'rights-v1'});
  assert.equal(r.status,404,'Not someone else World');
  r=await req(path,{method:'POST',cookie:owner.cookie,data:png(13),mime:'image/png'});
  assert.equal(r.status,428,'Owner must affirm un-checked declaration');
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_covers').get().n,0);
  r=await req(path,{method:'POST',cookie:owner.cookie,data:png(13),mime:'image/png',rights:'rights-v0'});
  assert.equal(r.status,428,'Obsolete declaration not accepted');
  r=await req(path,{method:'POST',cookie:owner.cookie,data:png(13),mime:'image/jpeg',rights:'rights-v1'});
  assert.equal(r.status,415,'PNG MIME remains mandatory');
  r=await req(path,{method:'POST',cookie:owner.cookie,data:Buffer.from('not a PNG'),mime:'image/png',rights:'rights-v1'});
  assert.equal(r.status,422);
  r=await req(path,{method:'POST',cookie:owner.cookie,data:png(13),mime:'image/png',rights:'rights-v1'});
  assert.equal(r.status,200);
  assert.equal(r.data.reviewStatus,'pending');
  assert.equal(r.data.rightsDeclarationRecorded,true);
  assert.equal(r.data.rightsDeclarationIsIndependentProof,false);
  let cover=lab.db.prepare('SELECT c.png,c.review_status,w.owner_id FROM world_covers c JOIN worlds w ON w.id=c.world_id WHERE w.slug=?').get(owner.world.slug);
  let rights=lab.db.prepare('SELECT * FROM world_cover_rights').get();
  const ownerId=lab.db.prepare("SELECT id FROM users WHERE username='artist74'").get().id;
  assert.equal(rights.owner_id,ownerId);
  assert.equal(rights.asset_sha256,sha(Buffer.from(cover.png)));
  assert.equal(rights.statement_version,'rights-v1');
  assert.ok(Number.isSafeInteger(rights.asserted_at)&&rights.asserted_at>0);
  r=await req('/account/export',{cookie:owner.cookie});
  assert.equal(r.status,200);
  assert.equal(r.data.worldCoverRights.length,1);
  assert.equal(r.data.worldCoverRights[0].assetSha256,rights.asset_sha256);
  assert.equal(r.data.worldCoverRightsHistory.length,1);
  assert.equal(r.data.worldCoverRightsHistory[0].assetSha256,rights.asset_sha256);
  assert.doesNotMatch(JSON.stringify(r.data.worldCoverRights),/private-owner@example|password_hash|PNG|session/);
  r=await req('/account/export',{cookie:stranger.cookie});
  assert.deepEqual(r.data.worldCoverRights,[]);
  // Claim cannot authorize arbitrary different binary pixels.
  lab.db.prepare('UPDATE world_cover_rights SET asset_sha256=?').run('0'.repeat(64));
  r=await req('/mod'+path+'/review',{method:'POST',cookie:mod.cookie,data:{decision:'approved'}});
  assert.equal(r.status,409);
  assert.equal((await req(path)).status,404);
  lab.db.prepare('UPDATE world_cover_rights SET asset_sha256=?').run(sha(Buffer.from(cover.png)));
  r=await req('/mod'+path+'/review',{method:'POST',cookie:mod.cookie,data:{decision:'approved'}});
  assert.equal(r.status,200);assert.equal((await req(path)).status,200);

  // Replacing an approved cover requires a NEW declaration for the NEW digest.
  const previousSha=rights.asset_sha256;
  r=await req(path,{method:'POST',cookie:owner.cookie,data:png(77),mime:'image/png'});
  assert.equal(r.status,428);
  assert.equal((await req(path)).status,200,'Rejected replacement leaves original approved cover');
  r=await req(path,{method:'POST',cookie:owner.cookie,data:png(77),mime:'image/png',rights:'rights-v1'});
  assert.equal(r.status,200);
  assert.equal((await req(path)).status,404,'New unapproved image never inherits old publication');
  cover=lab.db.prepare('SELECT png FROM world_covers').get();
  rights=lab.db.prepare('SELECT * FROM world_cover_rights').get();
  assert.notEqual(rights.asset_sha256,previousSha);
  assert.equal(rights.asset_sha256,sha(Buffer.from(cover.png)));
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_rights').get().n,1);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_rights_history').get().n,2);
  const evidence=lab.db.prepare('SELECT asset_sha256 FROM world_cover_rights_history ORDER BY id ASC').all();
  assert.deepEqual(evidence.map(x=>x.asset_sha256),[previousSha,rights.asset_sha256]);
  const ownerExport=await req('/account/export',{cookie:owner.cookie});
  assert.deepEqual(ownerExport.data.worldCoverRightsHistory.map(x=>x.assetSha256),[previousSha,rights.asset_sha256]);
  r=await req('/mod'+path+'/review',{method:'POST',cookie:owner.cookie,data:{decision:'approved'}});
  assert.equal(r.status,403,'Owner self approval forbidden even with rights declaration');
  r=await req('/mod'+path+'/review',{method:'POST',cookie:mod.cookie,data:{decision:'approved'}});
  assert.equal(r.status,200);
  r=await req(path,{method:'DELETE',cookie:owner.cookie,data:{}});
  assert.equal(r.status,200);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_rights').get().n,0);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_rights_history').get().n,0);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await lab.close();}
});
