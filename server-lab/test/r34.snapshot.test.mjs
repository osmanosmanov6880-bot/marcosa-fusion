import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,statSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {createVerifiedBackup,restoreVerifiedBackup} from '../tools/lab-snapshot.mjs';

test('R34 real on-disk SQLite: atomic snapshot, verified restore and fail-closed safety',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r34-'));
 const source=join(dir,'source.sqlite'),output=join(dir,'backup.sqlite'),restored=join(dir,'restored.sqlite');
 try{
  const app=createApp({databasePath:source});
  app.db.prepare("INSERT INTO users(id,email,username,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)")
   .run('u','u@example.org','userbackup','salt-not-shared','hash-not-shared',1);
  app.db.prepare("INSERT INTO worlds(id,owner_id,slug,title,created_at) VALUES(?,?,?,?,?)")
   .run('w','u','my-backup','My World',1);
  app.db.prepare("INSERT INTO posts(world_id,author_id,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?)")
   .run('w','u','Persisted publication','published',1,1);
  app.db.close();
  const snapshot=await createVerifiedBackup(source,output);
  assert.equal(snapshot.verified,true);
  assert.deepEqual(snapshot.counts,{users:1,worlds:1,posts:1});
  assert.match(snapshot.sha256,/^[a-f0-9]{64}$/);
  assert.equal(statSync(output).mode&0o777,0o600);
  const copy=await restoreVerifiedBackup(output,restored);
  assert.equal(copy.verified,true);
  assert.equal(copy.sha256,snapshot.sha256,'restored bytes match the source snapshot');
  const db=new DatabaseSync(restored,{readOnly:true});
  assert.equal(db.prepare('SELECT body FROM posts').get().body,'Persisted publication');
  assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash,'hash-not-shared');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.close();
  assert.equal(JSON.stringify(snapshot).includes('hash-not-shared'),false);
  assert.equal(JSON.stringify(copy).includes('salt-not-shared'),false);
  await assert.rejects(()=>createVerifiedBackup(source,output),/Refusing to overwrite/);
  await assert.rejects(()=>restoreVerifiedBackup(output,restored),/Refusing to overwrite/);
  const bad=join(dir,'bad.sqlite'),badTarget=join(dir,'bad-restored.sqlite');
  writeFileSync(bad,'not actually an SQLite database');
  await assert.rejects(()=>restoreVerifiedBackup(bad,badTarget),/SQLite|database/i);
  assert.equal(existsSync(badTarget),false);
  const link=join(dir,'symlink.sqlite');
  symlinkSync(source,link);
  await assert.rejects(()=>createVerifiedBackup(link,join(dir,'from-link.sqlite')),/non-symlink/);
  assert.equal(existsSync(join(dir,'from-link.sqlite')),false);
  await assert.rejects(()=>createVerifiedBackup(source,source),/separate/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
