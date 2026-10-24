import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';

test('R30 upgrades existing sponsor schema without losing rows',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'r30-upgrade-')),file=join(dir,'lab.sqlite');
 try{
  const initial=createApp({databasePath:file}); 
  await new Promise(ok=>initial.server.listen(0,'127.0.0.1',ok));
  initial.db.prepare("INSERT INTO users(id,email,username,salt,password_hash,created_at) VALUES('a','a@b.net','alpha','s','h',1)").run();
  initial.db.prepare("INSERT INTO worlds(id,owner_id,slug,title,created_at) VALUES('w','a','world-a','The World',1)").run();
  initial.db.prepare("INSERT INTO sponsor_proposals(owner_id,world_id,brand_name,headline,landing_url,status,created_at) VALUES('a','w','Brand','Existing creative','https://example.org','approved',1)").run();
  await initial.close();
  const old=new DatabaseSync(file);
  old.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
  const oldDDL="CREATE TABLE sponsor_old (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, brand_name TEXT NOT NULL, headline TEXT NOT NULL, landing_url TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending_creator','pending_review','approved','rejected')), created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL)";
  old.exec([oldDDL,"INSERT INTO sponsor_old SELECT * FROM sponsor_proposals","DROP TABLE sponsor_proposals","ALTER TABLE sponsor_old RENAME TO sponsor_proposals","CREATE INDEX idx_sponsor_status ON sponsor_proposals(status,id DESC)"].join(';')+';COMMIT;');
  old.close();
  const updated=createApp({databasePath:file});
  await new Promise(ok=>updated.server.listen(0,'127.0.0.1',ok));
  assert.equal(updated.db.prepare('SELECT count(*) AS n FROM sponsor_proposals').get().n,1);
  updated.db.prepare("UPDATE sponsor_proposals SET status='revoked' WHERE id=1").run();
  assert.equal(updated.db.prepare('SELECT status FROM sponsor_proposals WHERE id=1').get().status,'revoked');
  await updated.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
