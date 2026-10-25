import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R57: legacy accepted-image rows are conservatively quarantined by additive migration',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'marcosa-r57-legacy-'));
 const file=join(folder,'old-covers.sqlite');
 let app=null;
 try{
  const db=new DatabaseSync(file);
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,username TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','moderator')),created_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE worlds(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE world_covers(world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,png BLOB NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,byte_size INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO users(id,email,username,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)")
   .run('legacy-owner','legacy57@example.net','legacy57','a'.repeat(32),'b'.repeat(128),1);
  db.prepare("INSERT INTO worlds(id,owner_id,slug,title,description,created_at) VALUES(?,?,?,?,?,?)")
   .run('legacy-world','legacy-owner','legacy-media-57','Pre-review media World','Never erase history during migration',1);
  const fakePng=Buffer.from([137,80,78,71,13,10,26,10,0]);
  db.prepare('INSERT INTO world_covers(world_id,png,width,height,byte_size,updated_at) VALUES(?,?,?,?,?,?)')
   .run('legacy-world',fakePng,1,1,100,1);
  db.close();
  for(let n=0;n<2;n++){
   app=createApp({databasePath:file});
   const row=app.db.prepare('SELECT c.review_status,w.slug,w.title FROM world_covers c JOIN worlds w ON w.id=c.world_id WHERE w.slug=?').get('legacy-media-57');
   assert.equal(row.review_status,'pending');
   assert.equal(row.title,'Pre-review media World');
   assert.equal(app.db.prepare("SELECT count(*) AS n FROM pragma_table_info('world_covers') WHERE name IN ('review_status','reviewed_by','reviewed_at')").get().n,3);
   assert.equal(app.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='idx_world_cover_review_queue'").get().n,1);
   assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
   await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
   const base='http://127.0.0.1:'+app.server.address().port;
   const publicCover=await fetch(base+'/api/worlds/legacy-media-57/cover');
   assert.equal(publicCover.status,404,'previously uploaded cover not public without review');
   await app.close();app=null;
  }
 }finally{if(app){if(app.server.listening)await app.close();else app.db.close();}
  rmSync(folder,{recursive:true,force:true});}
});
