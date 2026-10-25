/**
 * MARCOSA R73 one-shot local SQLite backup -> seal -> isolated unseal -> compare.
 * All intermediate plaintext is in a temporary 0700 directory on the target
 * filesystem; only the verified AES-GCM archive is published create-only.
 * No internet, no production secrets, no timer or offsite destination.
 */
import {mkdtempSync,rmSync,lstatSync,linkSync,statSync,readFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {backupLocal,sha256,verifyDatabase} from './local-backup-restore.mjs';
import {sealSnapshot,unsealSnapshot,ARCHIVE_FORMAT} from './encrypted-local-archive.mjs';

function must(ok,msg){if(!ok)throw Error(msg);}
function safeOutput(path){
 must(typeof path==='string'&&path.length>0&&!path.includes('\0'),'Archive output path required');
 const dest=resolve(path);
 try{lstatSync(dest);throw Error('Archive destination already exists; overwrite forbidden');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const parent=lstatSync(dirname(dest));
 must(parent.isDirectory()&&!parent.isSymbolicLink(),'Archive parent must be a real directory');
 return dest;
}
export async function encryptedRecoveryDrill({database,destination,passphrasePath}){
 const out=safeOutput(destination);
 const dir=mkdtempSync(join(dirname(out),'.marcosa-encrypted-drill-'));
 let completed=false;
 try{
  const tempstat=lstatSync(dir);
  must(tempstat.isDirectory()&&(tempstat.mode&0o077)===0,'Temporary directory must be private');
  const src=join(dir,'snapshot.sqlite'),sealed=join(dir,'snapshot.marc'),restored=join(dir,'restored.sqlite');
  const backup=await backupLocal({source:database,destination:src});
  const encryption=await sealSnapshot({backup:src,manifest:src+'.json',
   destination:sealed,passphrasePath});
  const recovery=await unsealSnapshot({archive:sealed,destination:restored,passphrasePath});
  const same=await sha256(src)===await sha256(restored);
  must(same,'Isolated recovery differs from sealed input database');
  const verification=verifyDatabase(restored);
  must(verification.integrity==='ok'&&verification.foreignKeyViolations===0,
   'Recovered SQLite did not pass integrity and foreign keys');
  must(backup.sha256===recovery.sourceDigest,'Authenticated recovery manifest digest mismatch');
  safeOutput(out); // Repeat fail-closed check, then atomic O_EXCL-equivalent link.
  linkSync(sealed,out);
  completed=true;
  return{ok:true,archive:out,format:ARCHIVE_FORMAT,encrypted:true,
   isolatedRecoveryPassed:true,sha256Matches:true,
   sourceDatabaseUnmodified:true,producedBytes:statSync(out).size,
   sqliteVerification:verification,
   scope:'local SQLite only; not PostgreSQL PITR or offsite DR'};
 }finally{
  // Temporary 0600 plaintext and short-lived decrypted SQLite are not
  // persistent by default. Removal does not cryptographically wipe an SSD.
  rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
  if(!completed){
   // Never delete an unexpected existing destination: it may belong to
   // someone else. A hardlink is created only after all assertions pass.
  }
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),opts={};
  while(args.length){
   const flag=args.shift(),value=args.shift();
   must(['--db','--out','--passphrase-file'].includes(flag)&&!Object.hasOwn(opts,flag)
    &&typeof value==='string'&&value.length>0&&!value.startsWith('--'),
    'Usage: --db SQLITE --out NEW_ARCHIVE --passphrase-file PRIVATE_FILE');
   opts[flag]=value;
  }
  must(Object.keys(opts).length===3&&opts['--db']&&opts['--out']&&opts['--passphrase-file'],
   'Required: --db, --out and --passphrase-file');
  console.log(JSON.stringify(await encryptedRecoveryDrill({
   database:opts['--db'],destination:opts['--out'],passphrasePath:opts['--passphrase-file']}),null,2));
 }catch(error){console.error('MARCOSA ENCRYPTED RECOVERY DRILL BLOCKED: '+error.message);process.exitCode=1;}
}
