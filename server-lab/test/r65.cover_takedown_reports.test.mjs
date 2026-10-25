import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createApp} from '../server.mjs';

function crc(buffer){
 let value=0xffffffff;
 for(const n of buffer){value^=n;for(let k=0;k<8;k++)value=(value&1)?(value>>>1)^0xedb88320:(value>>>1);}
 return(value^0xffffffff)>>>0;
}
function chunk(name,data){
 const result=Buffer.alloc(data.length+12);
 result.writeUInt32BE(data.length,0);result.write(name,4,'ascii');data.copy(result,8);
 result.writeUInt32BE(crc(result.subarray(4,result.length-4)),result.length-4);return result;
}
function png(seed=17){
 const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
 const row=Buffer.from([0,seed,45,66,255,24,35,77,255]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);
}

test('R65: published PNG reports revoke approved cover only after independent decision, retain ownership and audit',async()=>{
 const lab=createApp({inviteCode:'r65-independent-review-test'});
 await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+lab.server.address().port,password='strong-local-png-report-test';
 async function req(path,{method='GET',cookie,data,origin=base,mime='application/json'}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']=mime;}
  if(method==='POST'&&path.endsWith('/cover')&&mime==='image/png')headers['X-Marcosa-Rights-Attestation']='rights-v1';
  const body=data===undefined?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data);
  const res=await fetch(base+'/api'+path,{method,headers,...(body===undefined?{}:{body})});
  const binary=(res.headers.get('content-type')||'').includes('image/png');
  return{status:res.status,data:binary?Buffer.from(await res.arrayBuffer()):await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 async function person(username){
  const email=username+'@example.net';
  const registration=await req('/auth/register',{method:'POST',data:{username,email,password,inviteCode:'r65-independent-review-test'}});
  assert.equal(registration.status,201,'register '+username);
  const login=await req('/auth/login',{method:'POST',data:{email,password}});
  assert.equal(login.status,200);
  const details=await req('/auth/me',{cookie:login.cookie});
  assert.equal(details.status,200);
  return{username,cookie:login.cookie,world:details.data.worlds[0]};
 }
 try{
  const owner=await person('owner65'),reporter=await person('reporter65'),
   first=await person('firstmod65'),second=await person('secondmod65');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username IN ('firstmod65','secondmod65')").run();
  const path='/worlds/'+owner.world.slug+'/cover';
  let res=await req(path,{method:'POST',cookie:owner.cookie,data:png(),mime:'image/png'});
  assert.equal(res.status,200);assert.equal(res.data.reviewStatus,'pending');
  res=await req('/mod'+path+'/review',{method:'POST',cookie:first.cookie,data:{decision:'approved'}});
  assert.equal(res.status,200);
  res=await req(path);assert.equal(res.status,200);
  const invalid=await req(path+'/report',{method:'POST',cookie:reporter.cookie,data:{reason:'copyright',detail:'short'}});
  assert.equal(invalid.status,400);
  res=await req(path+'/report',{method:'POST',cookie:owner.cookie,data:{reason:'privacy',detail:'This is my own private image'}});
  assert.equal(res.status,404,'owner cannot report own World');
  res=await req(path+'/report',{method:'POST',cookie:reporter.cookie,data:{reason:'copyright',detail:'This image appears to be copied without permission and requires review'},origin:'https://attacker.example'});
  assert.equal(res.status,403,'cross-site CSRF blocked');
  res=await req(path+'/report',{method:'POST',cookie:reporter.cookie,data:{reason:'copyright',detail:'This image appears to be copied without permission and requires review'}});
  assert.equal(res.status,201);assert.equal(res.data.status,'open');
  const reportId=res.data.id;
  res=await req(path+'/report',{method:'POST',cookie:reporter.cookie,data:{reason:'copyright',detail:'Second attempt for same pixels'}});
  assert.equal(res.status,409,'one report for same digest and user');
  res=await req('/me/cover-reports',{cookie:owner.cookie});
  assert.equal(res.status,200);assert.deepEqual(res.data.items,[],'owner cannot inspect reporter records');
  res=await req('/me/cover-reports',{cookie:reporter.cookie});
  assert.equal(res.status,200);assert.equal(res.data.items[0].id,reportId);
  res=await req('/mod/cover-reports',{cookie:reporter.cookie});assert.equal(res.status,403);
  res=await req('/mod/cover-reports',{cookie:first.cookie});
  assert.equal(res.status,200);assert.equal(res.data.items.length,0,'original approving moderator cannot judge own cover');
  res=await req('/mod/cover-reports',{cookie:second.cookie});
  assert.equal(res.status,200);assert.equal(res.data.items.length,1);
  assert.equal(res.data.items[0].slug,owner.world.slug);
  assert.doesNotMatch(JSON.stringify(res.data),/password|png|token_hash|salt|reporter_id|reporter65/);
  // Revoking the original approving moderator makes the previously public
  // asset ineligible for complaint adjudication as well as public delivery.
  lab.db.prepare("UPDATE users SET role='member' WHERE username='firstmod65'").run();
  res=await req('/mod/cover-reports',{cookie:second.cookie});
  assert.equal(res.status,200);assert.equal(res.data.items.length,0,'revoked approval cannot appear in live complaint queue');
  res=await req('/mod/cover-reports/'+reportId+'/resolve',{method:'POST',cookie:second.cookie,data:{decision:'upheld'}});
  assert.equal(res.status,404,'revoked prior approval cannot be adjudicated as public');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE username='firstmod65'").run();
  res=await req('/mod/cover-reports/'+reportId+'/resolve',{method:'POST',cookie:first.cookie,data:{decision:'upheld'}});
  assert.equal(res.status,403,'original reviewer cannot issue takedown');
  res=await req('/mod/cover-reports/'+reportId+'/resolve',{method:'POST',cookie:reporter.cookie,data:{decision:'upheld'}});
  assert.equal(res.status,403,'reporter may not review their own report');
  res=await req('/mod/cover-reports/'+reportId+'/resolve',{method:'POST',cookie:second.cookie,data:{decision:'upheld'}});
  assert.equal(res.status,200);assert.equal(res.data.publicVisible,false);
  res=await req(path);assert.equal(res.status,404,'real public bytes revoked on independent decision');
  res=await req('/me'+path,{cookie:owner.cookie});assert.equal(res.status,200,'creator still sees private rejected image');
  res=await req('/auth/me',{cookie:owner.cookie});
  assert.equal(res.data.worlds[0].coverStatus,'rejected','owner can appeal via R59');
  res=await req('/mod/cover-reports/'+reportId+'/resolve',{method:'POST',cookie:second.cookie,data:{decision:'dismissed'}});
  assert.equal(res.status,404,'once-only report review enforced');
  const audit=await req('/mod/cover-audit',{cookie:second.cookie});
  assert.deepEqual(audit.data.items.map(x=>x.decision),['rejected','approved']);
  const selfExport=await req('/account/export',{cookie:reporter.cookie});
  assert.equal(selfExport.data.coverReports.length,1);
  assert.equal(selfExport.data.coverReports[0].status,'upheld');

  // Second PNG: new report + dismissal must keep public bytes accessible.
  res=await req(path,{method:'POST',cookie:owner.cookie,data:png(63),mime:'image/png'});
  assert.equal(res.status,200);
  res=await req('/mod'+path+'/review',{method:'POST',cookie:first.cookie,data:{decision:'approved'}});
  assert.equal(res.status,200);
  res=await req(path+'/report',{method:'POST',cookie:reporter.cookie,data:{reason:'other',detail:'I would like an independent review of this image'}});
  assert.equal(res.status,201);const id2=res.data.id;
  res=await req('/mod/cover-reports/'+id2+'/resolve',{method:'POST',cookie:second.cookie,data:{decision:'dismissed'}});
  assert.equal(res.status,200);assert.equal(res.data.publicVisible,true);
  res=await req(path);assert.equal(res.status,200);

  // Replacing an approved image before pending-report review withdraws stale evidence.
  res=await req(path,{method:'POST',cookie:owner.cookie,data:png(71),mime:'image/png'});
  assert.equal(res.status,200);
  res=await req('/mod'+path+'/review',{method:'POST',cookie:first.cookie,data:{decision:'approved'}});
  assert.equal(res.status,200);
  res=await req(path+'/report',{method:'POST',cookie:reporter.cookie,data:{reason:'privacy',detail:'I think this is private content and needs moderation'}});
  assert.equal(res.status,201);const stale=res.data.id;
  res=await req(path,{method:'POST',cookie:owner.cookie,data:png(89),mime:'image/png'});
  assert.equal(res.status,200);assert.equal(res.data.reviewStatus,'pending');
  res=await req('/mod/cover-reports/'+stale+'/resolve',{method:'POST',cookie:second.cookie,data:{decision:'upheld'}});
  assert.equal(res.status,404,'replaced digest cannot be taken down by old report');
  res=await req('/mod/cover-reports',{cookie:second.cookie});
  assert.equal(res.data.items.length,0,'stale report removed from moderation queue');
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  // Only reporter's account deletion removes reporter-linked report history.
  res=await req('/account',{method:'DELETE',cookie:reporter.cookie,data:{confirm:'DELETE',password}});
  assert.equal(res.status,200);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_cover_reports').get().n,0);
  assert.equal(lab.db.prepare('SELECT count(*) AS n FROM world_covers').get().n,1,'owner media unaffected');
 }finally{await lab.close();}
});
