#!/usr/bin/env node
/* MARCOSA R34: OFFLINE SQLITE LAB SNAPSHOT.
 * Never connects to external services, accepts no URLs and refuses overwrites.
 * Snapshots contain private account data and password hashes; store securely.
 * NOT a substitute for verified PostgreSQL production disaster recovery.
 */
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,existsSync,lstatSync,chmodSync,copyFileSync,openSync,closeSync,linkSync,unlinkSync} from 'node:fs';
import {resolve,dirname,basename,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

function verifyInput(path){
 if(extname(path)!=='.sqlite')throw Error('Only local .sqlite files are allowed');
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('A regular non-symlink SQLite file is required');
}
function targetPath(source,destination){
 const dest=resolve(destination);
 if(extname(dest)!=='.sqlite'||dest===source)throw Error('Choose a separate .sqlite destination');
 if(existsSync(dest))throw Error('Refusing to overwrite an existing destination');
 const dir=lstatSync(dirname(dest));
 if(!dir.isDirectory())throw Error('Destination directory does not exist');
 return dest;
}
function verifyDatabase(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const values=db.prepare('PRAGMA integrity_check').all().map(x=>Object.values(x)[0]);
  if(values.length!==1||values[0]!=='ok')throw Error('SQLite integrity_check did not pass');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite foreign_key_check did not pass');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
  if(!['users','sessions','worlds','posts'].every(name=>tables.includes(name)))
   throw Error('Not a recognized MARCOSA local lab database');
  return {users:db.prepare('SELECT count(*) AS n FROM users').get().n,
   worlds:db.prepare('SELECT count(*) AS n FROM worlds').get().n,
   posts:db.prepare('SELECT count(*) AS n FROM posts').get().n};
 }finally{db.close();}
}
async function sha256(path){
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(path))hash.update(chunk);
 return hash.digest('hex');
}
async function operate(kind,sourcePath,destinationPath){
 if(typeof sourcePath!=='string'||typeof destinationPath!=='string')
  throw Error('Source and destination paths are required');
 const source=resolve(sourcePath);
 verifyInput(source);
 const destination=targetPath(source,destinationPath);
 // Validate before copying, then validate the completed snapshot/restore.
 verifyDatabase(source);
 const temporary=join(dirname(destination),'.'+basename(destination)+'.'+randomUUID()+'.partial');
 let copied=false,readDb;
 const previous=process.umask(0o077);
 try{
  if(kind==='backup'){
   readDb=new DatabaseSync(source,{readOnly:true});
   await sqliteBackup(readDb,temporary);
  }else if(kind==='restore'){
   const fd=openSync(temporary,'wx',0o600);closeSync(fd);
   copyFileSync(source,temporary);
  }else throw Error('Unsupported operation');
  copied=true;chmodSync(temporary,0o600);
  const counts=verifyDatabase(temporary);
  // Hard-link publication is atomic, on the same filesystem, and never replaces a file.
  linkSync(temporary,destination);
  unlinkSync(temporary);copied=false;
  return {operation:kind,path:destination,sha256:await sha256(destination),verified:true,counts};
 }finally{
  if(readDb)readDb.close();
  if(copied||existsSync(temporary)){
   try{unlinkSync(temporary);}catch{}
  }
  process.umask(previous);
 }
}
export const createVerifiedBackup=(source,destination)=>operate('backup',source,destination);
export const restoreVerifiedBackup=(source,destination)=>operate('restore',source,destination);

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,source,destination,...rest]=process.argv.slice(2);
 if(!['backup','restore'].includes(command)||!source||!destination||rest.length){
  console.error('Usage: node server-lab/tools/lab-snapshot.mjs backup|restore SOURCE.sqlite DESTINATION.sqlite');
  process.exitCode=2;
 }else{
  try{
   const result=command==='backup'
    ?await createVerifiedBackup(source,destination)
    :await restoreVerifiedBackup(source,destination);
   console.log(JSON.stringify(result));
  }catch(e){
   console.error('R34 local snapshot refused:',e.message);
   process.exitCode=1;
  }
 }
}
