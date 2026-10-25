import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R45: persisted one-use pilot invites, moderator-only issuance, replay resistance and real creator onboarding',async()=>{
 const tmp=mkdtempSync(join(tmpdir(),'marcosa-r45-'));
 const databasePath=join(tmp,'pilot.sqlite');
 const bootstrap='r45-bootstrap-legacy-code';
 const password='r45-strong-password-safe';
 let clock=Date.parse('2026-10-25T01:00:00Z');
 let app=null,base='';
 async function start(mode){
  app=createApp({databasePath,inviteCode:bootstrap,registrationMode:mode,now:()=>clock});
  await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
  base='http://127.0.0.1:'+app.server.address().port;
 }
 async function req(path,{method='GET',cookie,json,origin=base}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 const reg=(username,inviteCode)=>({username,email:username+'@example.net',password,inviteCode});
 async function login(username){
  const response=await req('/auth/login',{method:'POST',json:{email:username+'@example.net',password}});
  assert.equal(response.status,200);
  return response.cookie.split(';')[0];
 }
 try{
  await start('legacy');
  let x=await req('/auth/register',{method:'POST',json:reg('operator45',bootstrap)});
  assert.equal(x.status,201);
  x=await req('/auth/register',{method:'POST',json:reg('reader45',bootstrap)});
  assert.equal(x.status,201);
  await app.close();app=null;
  chmodSync(databasePath,0o600);
  const tool=fileURLToPath(new URL('../tools/bootstrap-moderator.mjs',import.meta.url));
  const boot=spawnSync(process.execPath,[tool,databasePath,'operator45','--confirm-offline'],{encoding:'utf8'});
  assert.equal(boot.status,0,'manual operator bootstrap should succeed: '+boot.stderr);
  const repeat=spawnSync(process.execPath,[tool,databasePath,'operator45','--confirm-offline'],{encoding:'utf8'});
  assert.equal(repeat.status,1,'second bootstrap must fail closed');

  await start('single-use');
  const operator=await login('operator45'),reader=await login('reader45');
  x=await req('/auth/register',{method:'POST',json:reg('bad45',bootstrap)});
  assert.equal(x.status,403,'bootstrap secret is not accepted in strict one-use mode');
  x=await req('/mod/invites');assert.equal(x.status,401);
  x=await req('/mod/invites',{cookie:reader});assert.equal(x.status,403);
  x=await req('/mod/invites',{cookie:operator});
  assert.equal(x.status,200);assert.deepEqual(x.data.items,[]);
  x=await req('/mod/invites',{cookie:reader,method:'POST',json:{label:'Hacked pilot'}});
  assert.equal(x.status,403);
  x=await req('/mod/invites',{cookie:operator,method:'POST',json:{expiresHours:0}});
  assert.equal(x.status,400);
  x=await req('/mod/invites',{cookie:operator,method:'POST',json:{label:'No',expiresHours:169}});
  assert.equal(x.status,400);
  x=await req('/mod/invites',{cookie:operator,method:'POST',json:{isAdmin:true}});
  assert.equal(x.status,400);
  x=await req('/mod/invites',{cookie:operator,method:'POST',origin:'https://evil.example',json:{label:'No'}});
  assert.equal(x.status,403);
  const ticket=(await req('/mod/invites',{cookie:operator,method:'POST',json:{label:'Creator cohort',expiresHours:36}}));
  assert.equal(ticket.status,201);assert.match(ticket.data.code,/^[a-f0-9]{48}$/);
  assert.equal(ticket.data.oneUse,true);
  const code=ticket.data.code,id=ticket.data.id;
  assert.equal(ticket.data.expiresAt,clock+36*3600000);
  const metadata=await req('/mod/invites',{cookie:operator});
  assert.equal(metadata.status,200);
  assert.equal(metadata.data.hasSecrets,false);
  assert.equal(metadata.data.items[0].id,id);
  assert.doesNotMatch(JSON.stringify(metadata.data),new RegExp(code));
  const dbRow=app.db.prepare('SELECT code_hash,used_at,used_by FROM pilot_invites WHERE id=?').get(id);
  assert.notEqual(dbRow.code_hash,code);
  assert.equal(dbRow.used_at,null);
  // Duplicate user must not burn an issued one-use invitation.
  x=await req('/auth/register',{method:'POST',json:reg('reader45',code)});
  assert.equal(x.status,409);
  assert.equal(app.db.prepare('SELECT used_at FROM pilot_invites WHERE id=?').get(id).used_at,null);
  const attempts=await Promise.all(['author45','rival45'].map(username=>
   req('/auth/register',{method:'POST',json:reg(username,code)})));
  assert.equal(attempts.filter(z=>z.status===201).length,1);
  assert.equal(attempts.filter(z=>z.status===403).length,1);
  const created=attempts[0].status===201?'author45':'rival45';
  const winner=await login(created);
  x=await req('/auth/register',{method:'POST',json:reg('late45',code)});
  assert.equal(x.status,403,'replay never creates second account');
  const used=app.db.prepare('SELECT used_at,used_by FROM pilot_invites WHERE id=?').get(id);
  assert.equal(used.used_at,clock);assert.ok(used.used_by);
  x=await req('/mod/invites/'+id+'/revoke',{cookie:operator,method:'POST',json:{}});
  assert.equal(x.status,409);
  const expiry=await req('/mod/invites',{cookie:operator,method:'POST',json:{label:'One hour',expiresHours:1}});
  assert.equal(expiry.status,201);
  clock+=3600001;
  x=await req('/auth/register',{method:'POST',json:reg('expired45',expiry.data.code)});
  assert.equal(x.status,403);
  clock-=3600001;
  const revoked=await req('/mod/invites',{cookie:operator,method:'POST',json:{label:'Revoke test',expiresHours:12}});
  assert.equal(revoked.status,201);
  x=await req('/mod/invites/'+revoked.data.id+'/revoke',{cookie:operator,method:'POST',json:{}});
  assert.equal(x.status,200);assert.equal(x.data.changed,true);
  x=await req('/mod/invites/'+revoked.data.id+'/revoke',{cookie:operator,method:'POST',json:{}});
  assert.equal(x.status,200);assert.equal(x.data.changed,false);
  x=await req('/auth/register',{method:'POST',json:reg('revoked45',revoked.data.code)});
  assert.equal(x.status,403);
  x=await req('/mod/invites',{cookie:reader});assert.equal(x.status,403);
  // Even another moderator cannot inspect this moderator's private invite ledger.
  app.db.prepare("UPDATE users SET role='moderator' WHERE username='reader45'").run();
  x=await req('/mod/invites',{cookie:reader});assert.equal(x.status,200);assert.deepEqual(x.data.items,[]);
  x=await req('/mod/invites/'+revoked.data.id+'/revoke',{cookie:reader,method:'POST',json:{}});
  assert.equal(x.status,404);

  x=await req('/me/onboarding');assert.equal(x.status,401);
  x=await req('/me/onboarding',{cookie:winner});
  assert.equal(x.status,200);assert.equal(x.data.completed,0);assert.equal(x.data.total,5);
  assert.equal(x.data.advertisingRevenue,null);assert.equal(x.data.retentionD7,null);
  assert.ok(x.data.steps.every(t=>!t.complete));
  const me=await req('/auth/me',{cookie:winner});
  const world=me.data.worlds[0];
  x=await req('/worlds/'+world.slug,{cookie:winner,method:'PATCH',json:{
   title:'A verified artist space',description:'An authentic creator studio for memorable original stories and trusted conversations'
  }});
  assert.equal(x.status,200);
  x=await req('/posts',{cookie:winner,method:'POST',json:{worldId:world.id,body:'First real story in the closed beta',status:'published'}});
  assert.equal(x.status,201);
  const readerWorld=(await req('/auth/me',{cookie:reader})).data.worlds[0];
  x=await req('/worlds/'+readerWorld.slug+'/follow',{cookie:winner,method:'POST',json:{}});
  assert.equal(x.status,201);
  const others=await req('/posts',{cookie:reader,method:'POST',json:{worldId:readerWorld.id,body:'A second author with a useful tip',status:'published'}});
  assert.equal(others.status,201);
  x=await req('/posts/'+others.data.id+'/save',{cookie:winner,method:'POST',json:{}});
  assert.equal(x.status,201);
  x=await req('/posts/'+others.data.id+'/comments',{cookie:winner,method:'POST',json:{body:'Thank you for the actionable advice'}});
  assert.equal(x.status,201);
  x=await req('/me/onboarding',{cookie:winner});
  assert.equal(x.status,200);assert.equal(x.data.completed,5);
  assert.ok(x.data.steps.every(t=>t.complete));
  x=await req('/me/onboarding',{cookie:reader});
  assert.equal(x.status,200);assert.ok(x.data.completed<5);
  // Account deletion must preserve invite audit without re-opening consumed codes.
  x=await req('/account',{cookie:winner,method:'DELETE',json:{confirm:'DELETE',password}});
  assert.equal(x.status,200);
  const after=app.db.prepare('SELECT used_at,used_by FROM pilot_invites WHERE id=?').get(id);
  assert.equal(after.used_at,clock);assert.equal(after.used_by,null);
  x=await req('/auth/register',{method:'POST',json:reg('replay45',code)});
  assert.equal(x.status,403);
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{
  if(app)await app.close();
  rmSync(tmp,{recursive:true,force:true});
 }
});
