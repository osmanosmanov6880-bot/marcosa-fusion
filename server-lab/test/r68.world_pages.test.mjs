import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createApp} from '../server.mjs';
function crc(b){let n=0xffffffff;for(const x of b){n^=x;for(let k=0;k<8;k++)n=(n&1)?(n>>>1)^0xedb88320:(n>>>1);}return(n^0xffffffff)>>>0;}
function chunk(name,data){const x=Buffer.alloc(data.length+12);x.writeUInt32BE(data.length,0);x.write(name,4,'ascii');data.copy(x,8);x.writeUInt32BE(crc(x.subarray(4,x.length-4)),x.length-4);return x;}
function png(){const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=6;const row=Buffer.from([0,33,44,55,255,66,77,88,255]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);}


test('R68 real share HTML: safe metadata, noindex, blocked users, older worlds and review revocation',async()=>{
 const app=createApp({inviteCode:'r68-private-world-link'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port,password='r68-very-long-password';
 async function req(path,{method='GET',cookie,data}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
  const body=await response.text();
  return{status:response.status,headers:response.headers,body,json:()=>JSON.parse(body)};
 }
 async function member(username){
  const email=username+'@example.net';
  let q=await req('/api/auth/register',{method:'POST',data:{email,username,password,inviteCode:'r68-private-world-link'}});
  assert.equal(q.status,201);
  q=await req('/api/auth/login',{method:'POST',data:{email,password}});assert.equal(q.status,200);
  return q.headers.get('set-cookie').split(';')[0];
 }
 try{
  await member('alice68');
  const bob=await member('bob68');
  await member('mod68');
  const slug='u-alice68',link='/w/'+slug;
  let page=await req(link);
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-type'),/text\/html/);
  assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
  assert.ok(page.body.includes('<meta property="og:site_name" content="MARCOSA">'));
  assert.ok(page.body.includes(base+link));
  assert.doesNotMatch(page.body,/og:image|alice68@example.net|password_hash/);

  app.db.prepare('UPDATE worlds SET title=?,description=? WHERE slug=?')
   .run('Creative "><script>window.injected=1</script>','<img src=x onerror=alert(1)>& safe studio',slug);
  page=await req(link);
  assert.equal(page.status,200);
  assert.ok(page.body.includes('&lt;script&gt;window.injected=1&lt;/script&gt;'));
  assert.ok(page.body.includes('&quot;&gt;&lt;script&gt;'));
  assert.ok(page.body.includes('&lt;img src=x onerror=alert(1)&gt;&amp;'));
  assert.doesNotMatch(page.body,/<script>window.injected=1<\/script>|<img src=x onerror=/);

  const w=app.db.prepare('SELECT id,owner_id FROM worlds WHERE slug=?').get(slug);
  const insert=app.db.prepare("INSERT INTO worlds(id,owner_id,slug,title,description,category,created_at) VALUES(?,?,?,?,?,?,?)");
  const later=Date.now()+900000;
  for(let n=0;n<36;n++)insert.run(randomUUID(),w.owner_id,'r68-archive-'+String(n).padStart(2,'0'),'World '+n,'Safe archive','art',later+n);
  const list=(await req('/api/worlds')).json();
  assert.equal(list.items.length,30);
  assert.equal(list.items.some(x=>x.slug===slug),false);
  assert.equal((await req(link)).status,200,'SSR works beyond first catalog page');

  let action=await req('/api/users/alice68/block',{method:'POST',cookie:bob,data:{}});
  assert.equal(action.status,201);
  assert.equal((await req(link,{cookie:bob})).status,404);
  assert.equal((await req(link)).status,200);
  app.db.prepare("UPDATE users SET role='moderator' WHERE username='mod68'").run();
  const reviewer=app.db.prepare("SELECT id FROM users WHERE username='mod68'").get().id;
  const pixels=png();
  app.db.prepare("INSERT INTO world_covers(world_id,png,width,height,byte_size,updated_at,review_status,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?)")
   .run(w.id,pixels,2,2,pixels.length,100,'approved',reviewer,101);
  assert.match((await req(link)).body,/<meta property="og:image"/);
  app.db.prepare("UPDATE users SET role='member' WHERE id=?").run(reviewer);
  assert.doesNotMatch((await req(link)).body,/<meta property="og:image"/);
  app.db.prepare("UPDATE world_covers SET review_status='rejected' WHERE world_id=?").run(w.id);
  assert.doesNotMatch((await req(link)).body,/<meta property="og:image"/);
  assert.equal((await req('/w/missing-68')).status,404);
  assert.equal((await req('/w/<script>')).status,404);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
