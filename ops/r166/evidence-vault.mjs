/**
 * R166 atomic local encrypted-evidence vault. Not remote object storage.
 * Writes only an R165 AES-GCM ciphertext envelope; no pg_dump plaintext.
 * All files owned by current operator, exclusive, fsynced and content-addressed.
 */
import {open,lstat,realpath,link,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {O_CREAT,O_EXCL,O_WRONLY,O_RDONLY,O_NOFOLLOW} from 'node:constants';

const H64=/^[a-f0-9]{64}$/;
const PREFIX=Buffer.from('MARCOSA-R165-BACKUP-V1\n');
const fail=m=>{throw Error('R166 evidence vault: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const MAX=25*1024*1024+2048;
async function rootCheck(root){
 ok(typeof root==='string'&&resolve(root)===root,'absolute root required');
 let stat;
 try{
  stat=await lstat(root);
  ok(stat.isDirectory()&&!stat.isSymbolicLink()&&
   (stat.mode&0o077)===0&&await realpath(root)===root,
   'canonical private directory required');
  if(typeof process.getuid==='function')
   ok(stat.uid===process.getuid(),'own private directory required');
 }catch{fail('private vault directory missing or unsafe');}
}
function ciphertextCheck(blob){
 ok(Buffer.isBuffer(blob)&&blob.length>700&&blob.length<=MAX&&
  blob.subarray(0,PREFIX.length).equals(PREFIX),
  'only bounded R165 encrypted backup envelopes accepted');
}
async function readFixed(root,digest){
 ok(H64.test(digest||''),'exact content-addressed digest required');
 const filename=join(root,digest+'.r165enc');
 let fh;
 try{
  const before=await lstat(filename);
  ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&
   (before.mode&0o077)===0&&before.size>700&&before.size<=MAX,
   'regular private single-linked ciphertext only');
  if(typeof process.getuid==='function')ok(before.uid===process.getuid(),'owner mismatch');
  fh=await open(filename,O_RDONLY|O_NOFOLLOW);
  const stat=await fh.stat();
  ok(stat.ino===before.ino&&stat.dev===before.dev&&stat.size===before.size,
   'vault file changed during open');
  const bytes=await fh.readFile();
  ciphertextCheck(bytes);
  const actual=Buffer.from(sha(bytes),'hex');
  const expected=Buffer.from(digest,'hex');
  ok(timingSafeEqual(actual,expected),'encrypted blob replaced or tampered');
  return bytes;
 }catch(e){fail('ciphertext absent or compromised');}
 finally{if(fh)await fh.close();}
}
export function createR166EvidenceVault({root}={}){
 const ready=rootCheck(root);
 async function putEncrypted({blob}={}){
  await ready;ciphertextCheck(blob);
  const digest=sha(blob),dest=join(root,digest+'.r165enc'),
   temp=join(root,'.pending-'+randomBytes(16).toString('hex'));
  let fd,tempPresent=false;
  try{
   fd=await open(temp,O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW,0o600);
   tempPresent=true;
   await fd.writeFile(blob);await fd.sync();await fd.close();fd=null;
   await link(temp,dest); // Fails if digest already exists; no overwrite/TOCTOU.
   await unlink(temp);tempPresent=false;
   const dir=await open(root,O_RDONLY);
   try{await dir.sync();}finally{await dir.close();}
   const result=await readFixed(root,digest);
   ok(result.equals(blob),'newly stored ciphertext readback mismatch');
   return Object.freeze({sha256:digest,size:result.length,
    locallyFsynced:true,immutableByApi:true,offsiteVerified:false,
    productionAuthorized:false});
  }catch{
   fail('exclusive encrypted write failed; no overwrite allowed');
  }finally{
   if(fd)await fd.close();
   if(tempPresent)try{await unlink(temp);}catch{}
  }
 }
 async function readEncrypted({sha256}={}){
  await ready;await rootCheck(root);
  const bytes=await readFixed(root,sha256);
  return Object.freeze({bytes,sha256,size:bytes.length,
   protectedByAesGcmEnvelope:true,externalCopyVerified:false,
   productionAuthorized:false});
 }
 async function replicateTo({sha256,targetVault}={}){
  await ready;
  ok(targetVault&&typeof targetVault.putEncrypted==='function'&&
   typeof targetVault.readEncrypted==='function','independent vault required');
  const source=await readEncrypted({sha256});
  const copy=await targetVault.putEncrypted({blob:source.bytes});
  const readback=await targetVault.readEncrypted({sha256});
  ok(readback.bytes.equals(source.bytes)&&copy.sha256===sha256,
   'copy ciphertext differs');
  return Object.freeze({sha256,copiedAndReadBack:true,
   independentHostVerified:false,externalStorageVerified:false,
   productionAuthorized:false});
 }
 return Object.freeze({putEncrypted,readEncrypted,replicateTo});
}
