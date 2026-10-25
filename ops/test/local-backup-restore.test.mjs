import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,lstatSync,symlinkSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createApp} from '../../server-lab/server.mjs';
import {backupLocal,restoreLocal,verifyDatabase,sha256,FORMAT} from '../local-backup-restore.mjs';

test('R67 real SQLite snapshot preserves users, binary covers, moderation and consent; fails closed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r67-'));
 const live=join(dir,'live.sqlite'),output=join(dir,'snapshot.sqlite'),restored=join(dir,'restored.sqlite');
 let app=null,copy=null;
 try{
  app=createApp({databasePath:live});
  const a='11111111-2222-4333-8444-555555555555',reviewer='33333333-4444-4555-8666-777777777777',w='aaaa-bbbb';
  const insert=app.db.prepare("INSERT INTO users(id,email,username,salt,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)");
  insert.run(a,'owner@example.invalid','owner_r67','0'.repeat(32),'a'.repeat(128),'member',123);
  insert.run(reviewer,'moderator@example.invalid','review_r67','1'.repeat(32),'b'.repeat(128),'moderator',123);
  app.db.prepare("INSERT INTO worlds(id,owner_id,slug,title,description,created_at) VALUES(?,?,?,?,?,?)").run(w,a,'backup-world','Backup World','backup acceptance',123);
  const blob=Buffer.alloc(92,17);
  app.db.prepare("INSERT INTO world_covers(world_id,png,width,height,byte_size,updated_at,review_status,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?)")
   .run(w,blob,2,2,blob.length,123,'approved',reviewer,125);
  app.db.prepare("INSERT INTO beta_retention_consents(user_id,consented_at,consented_day) VALUES(?,?,?)").run(a,172800000,2);
  app.db.prepare("INSERT INTO beta_retention_days(user_id,day_utc,source) VALUES(?,?,'consent')").run(a,2);
  assert.equal(verifyDatabase(live).integrity,'ok');
  const proof=await backupLocal({source:live,destination:output});
  assert.equal(proof.verification.integrity,'ok');
  assert.equal(lstatSync(output).mode&0o777,0o600);
  assert.equal(lstatSync(output+'.json').mode&0o777,0o600);
  const manifest=JSON.parse(readFileSync(output+'.json','utf8'));
  assert.equal(manifest.format,FORMAT);
  assert.equal(manifest.bytes,statSync(output).size);
  assert.equal(manifest.sha256,await sha256(output));
  assert.doesNotMatch(JSON.stringify(manifest),/owner@example.invalid|moderator@example.invalid/);
  const restoredInfo=await restoreLocal({backup:output,manifest:output+'.json',destination:restored});
  assert.equal(restoredInfo.verification.foreignKeyViolations,0);
  await app.close();app=null;
  copy=createApp({databasePath:restored});
  assert.equal(copy.db.prepare('SELECT count(*) AS n FROM users').get().n,2);
  assert.ok(copy.db.prepare('SELECT png FROM world_covers').get().png.equals(blob));
  assert.equal(copy.db.prepare('SELECT count(*) AS n FROM beta_retention_days').get().n,1);
  assert.deepEqual(copy.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await copy.close();copy=null;
  await assert.rejects(()=>restoreLocal({backup:output,manifest:output+'.json',destination:restored}),/already exists/);
  const damaged=join(dir,'damaged.sqlite');copyFileSync(output,damaged);
  const bytes=readFileSync(damaged);bytes[bytes.length-12]^=0xff;writeFileSync(damaged,bytes);
  await assert.rejects(()=>restoreLocal({backup:damaged,manifest:output+'.json',destination:join(dir,'untrusted.sqlite')}),/SHA-256 mismatch/);
  const link=join(dir,'link.sqlite');symlinkSync(output,link);
  await assert.rejects(()=>restoreLocal({backup:link,manifest:output+'.json',destination:join(dir,'linked.sqlite')}),/non-symlink/);
  await assert.rejects(()=>backupLocal({source:live,destination:output}),/already exists/);
  const cli=join(process.cwd(),'ops','local-backup-restore.mjs'),file=join(dir,'cli.sqlite');
  const got=JSON.parse(execFileSync(process.execPath,[cli,'backup','--db',restored,'--out',file],{encoding:'utf8'}));
  assert.equal(got.ok,true);
 }finally{
  if(app)await app.close().catch(()=>{});
  if(copy)await copy.close().catch(()=>{});
  rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
 }
});
