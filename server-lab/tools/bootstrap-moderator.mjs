#!/usr/bin/env node
/*
 * MARCOSA R45: OFFLINE operator bootstrap for the SQLite laboratory only.
 * Never used by the browser, preview, remote server or Supabase.
 * Requires an existing manually checked account and a private backup.
 * Grants exactly the FIRST moderator; repeated attempts fail closed.
 */
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {resolve,extname} from 'node:path';

const [input,username,consent,...extra]=process.argv.slice(2);
if(!input||!username||consent!=='--confirm-offline'||extra.length){
 console.error('Usage: node server-lab/tools/bootstrap-moderator.mjs PRIVATE.sqlite USERNAME --confirm-offline');
 process.exit(2);
}
let db;
try{
 const file=resolve(input),stats=lstatSync(file);
 if(extname(file)!=='.sqlite'||!stats.isFile()||stats.isSymbolicLink())
  throw Error('Only an existing regular non-symlink .sqlite file may be used');
 if((stats.mode&0o077)!==0)
  throw Error('Refusing a database readable by group/others; chmod 600 PRIVATE.sqlite first');
 if(!/^[a-z][a-z0-9_]{2,23}$/.test(username))throw Error('Invalid local username');
 db=new DatabaseSync(file);
 db.exec('PRAGMA foreign_keys=ON');
 const integrity=db.prepare('PRAGMA integrity_check').all();
 if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok'
   ||db.prepare('PRAGMA foreign_key_check').all().length)
  throw Error('Database integrity not verified');
 if(db.prepare("SELECT count(*) AS n FROM users WHERE role='moderator'").get().n!==0)
  throw Error('At least one moderator already exists; offline bootstrap is single-use');
 const user=db.prepare('SELECT id,role FROM users WHERE username=?').get(username);
 if(!user||user.role!=='member')throw Error('Existing member account required');
 db.exec('BEGIN IMMEDIATE');
 try{
  const change=db.prepare("UPDATE users SET role='moderator' WHERE id=? AND role='member'").run(user.id);
  if(change.changes!==1)throw Error('Role update not atomic');
  const terminated=db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id).changes;
  db.exec('COMMIT');
  console.log(JSON.stringify({operator:username,role:'moderator',sessionsRevoked:terminated,scope:'offline-local-lab'}));
 }catch(error){db.exec('ROLLBACK');throw error;}
}catch(error){
 console.error('MARCOSA R45 offline bootstrap REFUSED:',error.message);
 process.exitCode=1;
}finally{if(db)db.close();}
