import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R89: moderator-only readiness distinguishes process liveness, SQLite FK corruption and incident modes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r89-readiness-'));
 const file=join(dir,'lab.sqlite'),pass='r89-strong-synthetic-password';
 let lab=null,base='';
 async function boot(freeze=false,media=false){
  lab=createApp({databasePath:file,inviteCode:'r89-local-only',
   contentWritesDisabled:freeze,publicMediaDisabled:media});
  await new Promise(ok=>lab.server.listen(0,'127.0.0.1',ok));
  base='http://127.0.0.1:'+lab.server.address().port;
 }
 async function request(path,{method='GET',cookie,data}={}){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']='application/json';}
  const response=await fetch(base+'/api'+path,{method,headers,
   ...(data===undefined?{}:{body:JSON.stringify(data)})});
  return{status:response.status,data:await response.json(),
   cookie:response.headers.get('set-cookie')?.split(';')[0]||null,
   headers:response.headers};
 }
 async function member(username){
  const email=username+'@example.net';
  const created=await request('/auth/register',{method:'POST',
   data:{username,email,password:pass,inviteCode:'r89-local-only'}});
  assert.equal(created.status,201);
  const id=lab.db.prepare('SELECT id FROM users WHERE username=?').get(username).id;
  const login=await request('/auth/login',{method:'POST',data:{email,password:pass}});
  assert.equal(login.status,200);
  return{id,username,cookie:login.cookie};
 }
 try{
  await boot();
  const mod=await member('moderator89'),user=await member('creator89');
  lab.db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(mod.id);
  let x=await request('/mod/readiness');
  assert.equal(x.status,401,'Unauthorized cannot see database checks');
  x=await request('/mod/readiness',{cookie:user.cookie});
  assert.equal(x.status,403,'Member cannot read operator diagnostics');
  x=await request('/mod/readiness',{cookie:mod.cookie});
  assert.equal(x.status,200);
  assert.equal(x.data.ready,true);
  assert.deepEqual(x.data.sqlite,{
   quickCheckPassed:true,foreignKeysPassed:true,requiredTablesPresent:true});
  assert.equal(x.data.readReady,true);
  assert.equal(x.data.writeReady,true);
  assert.equal(x.data.publicMediaReady,true);
  assert.equal(x.data.production,false);
  assert.equal(x.headers.get('cache-control'),'no-store');
  const publicHealth=await request('/health');
  assert.equal(publicHealth.status,200);
  assert.equal(publicHealth.data.ok,true);

  // The control uses a genuine broken FK in a disposable SQLite DB.
  // Cheap /health remains green by design, operator readiness goes red.
  lab.db.exec('PRAGMA foreign_keys=OFF');
  lab.db.prepare('INSERT INTO world_follows(world_id,user_id,created_at) VALUES(?,?,?)')
   .run('r89-world-does-not-exist',user.id,Date.now());
  lab.db.exec('PRAGMA foreign_keys=ON');
  assert.equal(lab.db.prepare('PRAGMA foreign_key_check').all().length,1);
  x=await request('/mod/readiness',{cookie:mod.cookie});
  assert.equal(x.status,503);
  assert.equal(x.data.ready,false);
  assert.equal(x.data.sqlite.quickCheckPassed,true);
  assert.equal(x.data.sqlite.foreignKeysPassed,false);
  assert.equal(x.data.writeReady,false);
  assert.equal(x.headers.get('retry-after'),'60');
  assert.equal((await request('/health')).status,200,'Process liveness is distinct');
  assert.doesNotMatch(JSON.stringify(x.data),/creator89|moderator89|example.net|r89-world-does-not-exist|sqlite3|\\/tmp\\//);
  lab.db.prepare('DELETE FROM world_follows WHERE world_id=?').run('r89-world-does-not-exist');
  x=await request('/mod/readiness',{cookie:mod.cookie});
  assert.equal(x.status,200);
  assert.equal(x.data.sqlite.foreignKeysPassed,true);
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await lab.close();lab=null;

  // Restart the actual file database in both safe incident modes.
  await boot(true,true);
  x=await request('/mod/readiness',{cookie:mod.cookie});
  assert.equal(x.status,200);
  assert.equal(x.data.readReady,true);
  assert.equal(x.data.writeReady,false);
  assert.equal(x.data.publicMediaReady,false);
  assert.equal(x.data.incidentContentFreeze,true);
  assert.equal(x.data.incidentPublicMediaShutdown,true);
  assert.equal((await request('/health')).data.contentWrites,'disabled');
  // Role changes take effect on every sensitive operation, not merely login.
  lab.db.prepare("UPDATE users SET role='member' WHERE id=?").run(mod.id);
  x=await request('/mod/readiness',{cookie:mod.cookie});
  assert.equal(x.status,403,'Demoted moderator cannot inspect diagnostic data');
  assert.deepEqual(lab.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{
  if(lab)await lab.close().catch(()=>{});
  rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
 }
});
