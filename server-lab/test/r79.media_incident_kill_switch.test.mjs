import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createApp} from '../server.mjs';

function crc(b){let n=0xffffffff;for(const c of b){n^=c;for(let i=0;i<8;i++)n=(n&1)?(n>>>1)^0xedb88320:(n>>>1);}return (n^0xffffffff)>>>0;}
function chunk(k,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length,0);b.write(k,4,'ascii');data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,b.length-4)),b.length-4);return b;}
function png(){const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=6;const row=Buffer.from([0,33,44,55,255,66,77,88,255]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);}

test('R79 local incident media switch hides all public routes, preserves private creator previews, and restores safely',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r79-')),file=join(dir,'social.sqlite');
 let app=null,base='',ownerCookie=null,slug='u-owner79';
 const inviteCode='r79-local-emergency-media';
 async function open(disabled){
  app=createApp({databasePath:file,inviteCode,publicMediaDisabled:disabled});
  await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
  base='http://127.0.0.1:'+app.server.address().port;
 }
 async function req(path,{cookie,method='GET',data}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
  const ct=response.headers.get('content-type')||'';
  return{status:response.status,headers:response.headers,
   json:ct.includes('application/json')?await response.json():null,
   binary:ct.includes('image/png')?Buffer.from(await response.arrayBuffer()):null,
   html:ct.includes('text/html')?await response.text():null};
 }
 async function assertEligibility(expectedVisible){
  const catalog=await req('/api/worlds');
  assert.equal(catalog.status,200);
  assert.equal(catalog.json.items.find(w=>w.slug===slug).hasCover,expectedVisible?1:0);
  const search=await req('/api/discover?q=Safety');
  assert.equal(search.status,200);
  assert.equal(search.json.worlds.find(w=>w.slug===slug).hasCover,expectedVisible?1:0);
  const detail=await req('/api/worlds/'+slug);
  assert.equal(detail.status,200);assert.equal(detail.json.world.hasCover,expectedVisible?1:0);
  const html=await req('/w/'+slug);
  assert.equal(html.status,200);
  assert.equal(html.headers.get('x-robots-tag'),'noindex, nofollow');
  if(expectedVisible)assert.match(html.html,/<meta property="og:image"/);
  else assert.doesNotMatch(html.html,/<meta property="og:image"/);
  const media=await req('/api/worlds/'+slug+'/cover');
  assert.equal(media.status,expectedVisible?200:503);
  if(!expectedVisible){
   assert.equal(media.headers.get('cache-control'),'no-store');
   assert.match(media.json.error,/приостановлена/);
   assert.equal(media.json.production,false);
  }
  return media;
 }
 try{
  await open(false);
  const owner='owner79',email='owner79@example.invalid',password='r79-long-private-test-password';
  let res=await req('/api/auth/register',{method:'POST',data:{username:owner,email,password,inviteCode}});
  assert.equal(res.status,201);
  const auth=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},
   body:JSON.stringify({email,password})});
  assert.equal(auth.status,200);ownerCookie=auth.headers.get('set-cookie').split(';')[0];
  const u=app.db.prepare('SELECT id FROM users WHERE username=?').get(owner);
  app.db.prepare('UPDATE worlds SET title=? WHERE slug=?').run('Safety World Demo',slug);
  const id=app.db.prepare('SELECT id FROM worlds WHERE slug=?').get(slug).id;
  const reviewer=randomUUID(),photo=png(),sha=createHash('sha256').update(photo).digest('hex');
  app.db.prepare('INSERT INTO users(id,email,username,salt,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)')
   .run(reviewer,'moderator79@example.invalid','mod79','1'.repeat(32),'a'.repeat(128),'moderator',100);
  app.db.prepare('INSERT INTO world_covers(world_id,png,width,height,byte_size,updated_at,review_status,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id,photo,2,2,photo.length,111,'approved',reviewer,112);
  app.db.prepare("INSERT INTO world_cover_rights(world_id,owner_id,asset_sha256,statement_version,asserted_at) VALUES(?,?,?,'rights-v1',?)")
   .run(id,u.id,sha,113);
  const before=await assertEligibility(true);
  assert.ok(before.binary.equals(photo));
  let privateOwner=await req('/api/me/worlds/'+slug+'/cover',{cookie:ownerCookie});
  assert.equal(privateOwner.status,200);
  assert.ok(privateOwner.binary.equals(photo));
  await app.close();app=null;

  await open(true);
  const health=await req('/api/health');
  assert.equal(health.json.publicMediaDelivery,'disabled');
  await assertEligibility(false);
  assert.equal((await req('/api/worlds/missing-world/cover')).status,503,
   'Incident mode never discloses whether a public cover exists');
  privateOwner=await req('/api/me/worlds/'+slug+'/cover',{cookie:ownerCookie});
  assert.equal(privateOwner.status,200,'Private owner preview remains available for evidence and review');
  assert.ok(privateOwner.binary.equals(photo));
  assert.equal((await req('/api/me/worlds/'+slug+'/cover')).status,401,
   'Emergency mode does not weaken owner authentication');
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM world_covers').get().n,1);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM world_cover_rights').get().n,1);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await app.close();app=null;

  await open(false);
  assert.equal((await req('/api/health')).json.publicMediaDelivery,'enabled');
  const after=await assertEligibility(true);
  assert.ok(after.binary.equals(photo),'Service recovery did not change underlying PNG bytes');
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM world_covers').get().n,1);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>createApp({publicMediaDisabled:'true'}),/Media emergency mode must be a boolean/);
 }finally{
  if(app)await app.close().catch(()=>{});
  rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
 }
});

test('R79 command-line emergency flag rejects typos rather than silently publishing',()=>{
 const cli=spawnSync(process.execPath,['server-lab/server.mjs'],{
  env:{...process.env,MARCOSA_DISABLE_PUBLIC_MEDIA:'maybe',HOST:'127.0.0.1'},
  encoding:'utf8',timeout:3000});
 assert.equal(cli.status,1,cli.stderr);
 assert.match(cli.stderr,/MARCOSA_DISABLE_PUBLIC_MEDIA must be 0 or 1/);
});
