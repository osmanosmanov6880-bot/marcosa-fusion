import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('R52: old SQLite worlds survive additive category migration and second restart',()=>{
 const folder=mkdtempSync(join(tmpdir(),'marcosa-old-worlds-'));
 const databasePath=join(folder,'legacy.sqlite');
 try{
  const db=new DatabaseSync(databasePath);
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,username TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','moderator')),created_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE worlds(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO users(id,email,username,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)")
   .run('legacy-user','legacy52@example.net','legacy52','a'.repeat(32),'b'.repeat(128),1);
  db.prepare("INSERT INTO worlds(id,owner_id,slug,title,description,created_at) VALUES(?,?,?,?,?,?)")
   .run('old-world','legacy-user','legacy-world-52','Living legacy World','Original historical description',1);
  db.close();
  for(let attempt=0;attempt<2;attempt++){
   const app=createApp({databasePath});
   const row=app.db.prepare("SELECT slug,title,description,category FROM worlds WHERE id='old-world'").get();
   assert.equal(row.category,'general');
   assert.equal(row.slug,'legacy-world-52');
   assert.equal(row.title,'Living legacy World');
   assert.equal(row.description,'Original historical description');
   assert.equal(app.db.prepare("SELECT count(*) AS n FROM pragma_table_info('worlds') WHERE name='category'").get().n,1);
   assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
   app.db.close();
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
