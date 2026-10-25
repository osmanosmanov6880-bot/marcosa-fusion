/**
 * MARCOSA R67: deterministic, operator-initiated backup and verify-only restore
 * of the LOOPBACK SQLite lab. Not a production or offsite backup solution.
 * No automatic schedule, deletion of sources or overwrite flag.
 */
import {DatabaseSync} from 'node:sqlite';
import {createReadStream,existsSync,lstatSync,statSync,openSync,closeSync,
 chmodSync,renameSync,rmSync,copyFileSync,readFileSync,writeFileSync,constants} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const FORMAT='MARCOSA-LOCAL-SQLITE-SNAPSHOT-v1';
function assert(value,message){if(!value)throw Error(message);}
function safeExisting(value,label){
 assert(typeof value==='string'&&value.length>0&&!value.includes('\0'),label+' path required');
 const path=resolve(value),info=lstatSync(path);
 assert(info.isFile()&&!info.isSymbolicLink(),label+' must be a regular non-symlink file');
 return path;
}
function safeNew(value,label){
 assert(typeof value==='string'&&value.length>0&&!value.includes('\0'),label+' path required');
 const path=resolve(value);
 assert(!existsSync(path),label+' already exists; overwrites forbidden');
 const parent=lstatSync(dirname(path));
 assert(parent.isDirectory()&&!parent.isSymbolicLink(),label+' parent must be a real directory');
 return path;
}
function sqlPath(path){return "'"+path.replaceAll("'","''")+"'";}
function temporary(path){
 const tmp=path+'.incomplete-'+randomBytes(12).toString('hex');
 const fd=openSync(tmp,'wx',0o600);
 closeSync(fd);return tmp;
}
export async function sha256(path){
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(path))hash.update(chunk);
 return hash.digest('hex');
}
export function verifyDatabase(path){
 const file=safeExisting(path,'SQLite');
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const check=db.prepare('PRAGMA integrity_check').all();
  assert(check.length===1&&check[0].integrity_check==='ok','SQLite integrity_check failed');
  const invalid=db.prepare('PRAGMA foreign_key_check').all();
  assert(invalid.length===0,'SQLite foreign_key_check failed');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
   .map(row=>row.name).sort();
  for(const name of ['users','sessions','worlds','world_covers','world_cover_reports','beta_retention_consents']){
   assert(tables.includes(name),'Missing MARCOSA table '+name);
  }
  return{integrity:'ok',foreignKeyViolations:0,tableCount:tables.length};
 }finally{db.close();}
}
export async function backupLocal({source,destination,createdAt=new Date().toISOString()}){
 const dbPath=safeExisting(source,'Source database'),out=safeNew(destination,'Backup destination');
 const manifestPath=safeNew(out+'.json','Backup manifest');
 assert(dbPath!==out&&dbPath!==manifestPath,'Source and destination must differ');
 // Restrict generated backup permissions even when the caller has a permissive umask.
 const previousUmask=process.umask(0o077);
 let temp=null,tempManifest=null;
 try{
  verifyDatabase(dbPath);
  temp=temporary(out);
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{db.exec('VACUUM INTO '+sqlPath(temp));}
  finally{db.close();}
  chmodSync(temp,0o600);
  const verification=verifyDatabase(temp);
  const bytes=statSync(temp).size;
  assert(bytes>0,'Empty backup file');
  const digest=await sha256(temp);
  const manifest={format:FORMAT,createdAt,sha256:digest,bytes,validation:verification,
   policy:'sensitive local lab data, private offline archive only; not encrypted or offsite'};
  tempManifest=temporary(manifestPath);
  writeFileSync(tempManifest,JSON.stringify(manifest,null,2)+'\n',{flag:'w',mode:0o600});
  chmodSync(tempManifest,0o600);
  assert(!existsSync(out)&&!existsSync(manifestPath),'Backup destination appeared during operation');
  renameSync(temp,out);temp=null;
  renameSync(tempManifest,manifestPath);tempManifest=null;
  return{backup:out,manifest:manifestPath,sha256:digest,bytes,verification};
 }catch(error){
  if(temp)rmSync(temp,{force:true});
  if(tempManifest)rmSync(tempManifest,{force:true});
  // Never leave an apparently usable orphaned snapshot without its manifest.
  if(existsSync(out)&&!existsSync(manifestPath))rmSync(out,{force:true});
  throw error;
 }finally{process.umask(previousUmask);}
}
export async function restoreLocal({backup,manifest,destination}){
 const src=safeExisting(backup,'Backup'),proof=safeExisting(manifest,'Manifest');
 const out=safeNew(destination,'Restore target');
 assert(out!==src&&out!==proof,'Restore must target a distinct path');
 const data=JSON.parse(readFileSync(proof,'utf8'));
 assert(data&&data.format===FORMAT&&/^[a-f0-9]{64}$/.test(data.sha256)
  &&Number.isSafeInteger(data.bytes)&&data.bytes>0,'Invalid or unsupported backup manifest');
 assert(statSync(src).size===data.bytes,'Backup size does not match manifest');
 assert(await sha256(src)===data.sha256,'Backup SHA-256 mismatch');
 verifyDatabase(src);
 const oldUmask=process.umask(0o077);
 let temp=null;
 try{
  temp=out+'.incomplete-'+randomBytes(12).toString('hex');
  copyFileSync(src,temp,constants.COPYFILE_EXCL);
  chmodSync(temp,0o600);
  const verification=verifyDatabase(temp);
  assert(await sha256(temp)===data.sha256,'Restore copy SHA-256 mismatch');
  assert(!existsSync(out),'Restore target unexpectedly appeared');
  renameSync(temp,out);temp=null;
  return{restored:out,sourceDigest:data.sha256,verification};
 }finally{
  if(temp)rmSync(temp,{force:true});
  process.umask(oldUmask);
 }
}
function argumentsFromCLI(args){
 const mode=args.shift();
 assert(mode==='backup'||mode==='restore','Usage: backup --db PATH --out PATH or restore --backup PATH --manifest PATH --out PATH');
 const opts={};
 while(args.length){
  const key=args.shift();
  assert(['--db','--out','--backup','--manifest'].includes(key)&&!Object.hasOwn(opts,key),'Unknown or duplicate CLI argument');
  const value=args.shift();
  assert(value&&!value.startsWith('--'),'Missing CLI value for '+key);
  opts[key]=value;
 }
 if(mode==='backup')assert(opts['--db']&&opts['--out']&&Object.keys(opts).length===2,'Backup requires --db and --out only');
 if(mode==='restore')assert(opts['--backup']&&opts['--manifest']&&opts['--out']&&Object.keys(opts).length===3,'Restore requires --backup, --manifest and --out only');
 return{mode,opts};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {mode,opts}=argumentsFromCLI(process.argv.slice(2));
  const result=mode==='backup'
   ?await backupLocal({source:opts['--db'],destination:opts['--out']})
   :await restoreLocal({backup:opts['--backup'],manifest:opts['--manifest'],destination:opts['--out']});
  console.log(JSON.stringify({ok:true,...result},null,2));
 }catch(error){console.error('MARCOSA LOCAL BACKUP/RESTORE BLOCKED:',error.message);process.exitCode=1;}
}
