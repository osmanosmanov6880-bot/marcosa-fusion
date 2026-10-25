/**
 * MARCOSA R73 — verified, sealed and tamper-evident SQLite laboratory archive.
 * AES-256-GCM + scrypt (32768/8/1). Archives authenticate an internal R67
 * JSON manifest AND real SQLite snapshot, never user data to stdout.
 * NOT PostgreSQL PITR or a production Storage backup.
 */
import {
 createReadStream,createWriteStream,readFileSync,writeSync,openSync,closeSync,
 readSync,fstatSync,lstatSync,statSync,linkSync,rmSync,constants
} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {promisify} from 'node:util';
import {randomBytes,scrypt as scryptCallback,createCipheriv,createDecipheriv} from 'node:crypto';
import {verifyDatabase,sha256,FORMAT} from './local-backup-restore.mjs';

const scrypt=promisify(scryptCallback);
export const ARCHIVE_FORMAT='MARCENC1';
const MAGIC=Buffer.from(ARCHIVE_FORMAT,'ascii');
const HEADER_LENGTH=8+16+12,AUTH_TAG_LENGTH=16,MANIFEST_MAX=16384;
const KDF=Object.freeze({N:1<<15,r:8,p:1,maxmem:64*1024*1024});
const demand=(condition,message)=>{if(!condition)throw Error(message);};
function regular(path,label){
 demand(typeof path==='string'&&path.length>0&&!path.includes('\0'),label+' path required');
 const full=resolve(path),st=lstatSync(full);
 demand(st.isFile()&&!st.isSymbolicLink(),label+' must be a regular non-symlink file');
 return full;
}
function newTarget(path){
 demand(typeof path==='string'&&path.length>0&&!path.includes('\0'),'Output path required');
 const out=resolve(path);
 try{
  lstatSync(out);
  throw Error('Output already exists; overwriting and symlinks are forbidden');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const st=lstatSync(dirname(out));
 demand(st.isDirectory()&&!st.isSymbolicLink(),'Output directory must be real and not a symlink');
 return out;
}
function tempPath(dest){
 const path=dest+'.incomplete-'+randomBytes(16).toString('hex');
 const fd=openSync(path,'wx',0o600);closeSync(fd);
 return path;
}
function passphraseFile(path){
 const p=regular(path,'Passphrase file'),fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=fstatSync(fd);
  demand(st.isFile()&&(st.mode&0o077)===0,'Passphrase file must be private (chmod 600)');
  demand(st.size>=24&&st.size<=4096,'Passphrase file must contain 24–4096 private bytes');
  let value=readFileSync(fd);
  if(value.at(-1)===10)value=value.subarray(0,value.length-1);
  demand(value.length>=24&&value.length<=4096,'Passphrase file must contain at least 24 private bytes');
  return value;
 }finally{closeSync(fd);}
}
async function deriveKey(pass,salt){return Buffer.from(await scrypt(pass,salt,32,KDF));}
function manifestFor(backup,manifestPath){
 const raw=readFileSync(manifestPath);
 demand(raw.length>0&&raw.length<=MANIFEST_MAX,'Manifest is too large');
 const data=JSON.parse(raw.toString('utf8'));
 demand(data&&data.format===FORMAT&&/^[a-f0-9]{64}$/.test(data.sha256)&&
   Number.isSafeInteger(data.bytes)&&data.bytes>0,'Unsupported or damaged R67 manifest');
 demand(statSync(backup).size===data.bytes,'SQLite bytes mismatch manifest');
 return{raw,data};
}
function outputLink(temp,dest){
 // Atomic create-only hard link, no existing destination can be replaced.
 linkSync(temp,dest);rmSync(temp);return dest;
}
function unpublishedCleanup(temp){if(temp)rmSync(temp,{force:true});}
function containsOnlyKnownArgs(mode,opts){
 const keys=Object.keys(opts).sort();
 const expected=(mode==='seal'?['--db','--manifest','--out','--passphrase-file']:
 mode==='unseal'?['--archive','--out','--passphrase-file']:[]).sort();
 demand(keys.length===expected.length&&keys.every((k,i)=>k===expected[i]),
 'Usage: seal --db SNAP --manifest SNAP.json --out ARCHIVE --passphrase-file FILE; or unseal --archive ARCHIVE --out NEW.sqlite --passphrase-file FILE');
}
export async function sealSnapshot({backup,manifest,destination,passphrasePath}){
 const src=regular(backup,'Source SQLite'),proof=regular(manifest,'Source manifest');
 const out=newTarget(destination),password=regular(passphrasePath,'Passphrase file');
 demand(new Set([src,proof,out,password]).size===4,'All archive inputs and output paths must differ');
 const secret=passphraseFile(password);
 const {raw,data}=manifestFor(src,proof);
 verifyDatabase(src);
 demand(await sha256(src)===data.sha256,'Snapshot SHA-256 mismatch');
 const salt=randomBytes(16),nonce=randomBytes(12),header=Buffer.concat([MAGIC,salt,nonce]);
 const key=await deriveKey(secret,salt);
 secret.fill(0);
 const cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});
 cipher.setAAD(header);
 key.fill(0);
 let temp=null;
 try{
  temp=tempPath(out);
  const handle=openSync(temp,'r+');try{writeSync(handle,header);}finally{closeSync(handle);}
  const length=Buffer.alloc(4);length.writeUInt32BE(raw.length,0);
  async function* plaintext(){
   yield length;yield raw;
   for await(const part of createReadStream(src))yield part;
  }
  await pipeline(Readable.from(plaintext()),cipher,createWriteStream(temp,{flags:'a',mode:0o600}));
  const tag=cipher.getAuthTag(),handle=openSync(temp,'a');
  try{writeSync(handle,tag);}finally{closeSync(handle);}
  demand(statSync(temp).size===HEADER_LENGTH+4+raw.length+data.bytes+AUTH_TAG_LENGTH,
   'Encrypted archive length mismatch');
  outputLink(temp,out);temp=null;
  return{archive:out,format:ARCHIVE_FORMAT,encrypted:true,algorithm:'AES-256-GCM',
   kdf:'scrypt-32768-8-1',bytes:statSync(out).size,
   verification:{integrity:'ok',foreignKeyViolations:0}};
 }finally{unpublishedCleanup(temp);}
}
export async function unsealSnapshot({archive,destination,passphrasePath}){
 const src=regular(archive,'Encrypted archive'),out=newTarget(destination);
 const password=regular(passphrasePath,'Passphrase file');
 demand(new Set([src,out,password]).size===3,'All archive paths must differ');
 const total=statSync(src).size;
 demand(total>=HEADER_LENGTH+AUTH_TAG_LENGTH+4+100,'Archive is truncated');
 const fd=openSync(src,constants.O_RDONLY|constants.O_NOFOLLOW);
 let header,tag;
 try{
  header=Buffer.alloc(HEADER_LENGTH);tag=Buffer.alloc(AUTH_TAG_LENGTH);
  demand(readSync(fd,header,0,HEADER_LENGTH,0)===HEADER_LENGTH,'Archive header missing');
  demand(header.subarray(0,8).equals(MAGIC),'Unrecognized archive format');
  demand(readSync(fd,tag,0,AUTH_TAG_LENGTH,total-AUTH_TAG_LENGTH)===AUTH_TAG_LENGTH,'Authentication tag missing');
 }finally{closeSync(fd);}
 const pass=passphraseFile(password),key=await deriveKey(pass,header.subarray(8,24));
 pass.fill(0);
 const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(24,36),{authTagLength:16});
 key.fill(0);
 decipher.setAAD(header);decipher.setAuthTag(tag);
 let temp=null,handle=null,manifest=null,needed=null,prefix=Buffer.alloc(0),bytes=0;
 try{
  temp=tempPath(out);
  handle=openSync(temp,'r+');
  const input=createReadStream(src,{start:HEADER_LENGTH,end:total-AUTH_TAG_LENGTH-1});
  // Authentication only becomes true when the authenticated stream reaches EOF.
  // Any bytes emitted before verification remain private in an unpublished 0600 file.
  for await(const block of input.pipe(decipher)){
   let chunk=block;
   if(!manifest){
    prefix=Buffer.concat([prefix,block]);
    if(needed===null&&prefix.length>=4){
     needed=prefix.readUInt32BE(0);
     demand(needed>0&&needed<=MANIFEST_MAX,'Encrypted manifest length invalid');
    }
    if(needed===null||prefix.length<4+needed)continue;
    manifest=JSON.parse(prefix.subarray(4,4+needed).toString('utf8'));
    chunk=prefix.subarray(4+needed);
    prefix=Buffer.alloc(0);
   }
   if(chunk.length){writeSync(handle,chunk);bytes+=chunk.length;}
  }
  closeSync(handle);handle=null;
  demand(manifest&&manifest.format===FORMAT&&
   /^[a-f0-9]{64}$/.test(manifest.sha256)&&Number.isSafeInteger(manifest.bytes)&&
   manifest.bytes>0,'Encrypted manifest malformed');
  demand(bytes===manifest.bytes,'Authenticated SQLite size mismatch');
  demand(await sha256(temp)===manifest.sha256,'Authenticated SQLite digest mismatch');
  const verification=verifyDatabase(temp);
  outputLink(temp,out);temp=null;
  return{restored:out,format:ARCHIVE_FORMAT,sourceDigest:manifest.sha256,bytes,verification};
 }catch(error){
  if(error.code==='ERR_OSSL_EVP_BAD_DECRYPT'||/authenticate data/i.test(error.message))
   throw Error('Authentication failed: incorrect passphrase or altered archive');
  throw error;
 }finally{
  if(handle!==null)closeSync(handle);
  unpublishedCleanup(temp);
 }
}
function parseCLI(args){
 const mode=args.shift(),opts={};
 demand(mode==='seal'||mode==='unseal','Use seal or unseal');
 while(args.length){
  const k=args.shift(),v=args.shift();
  demand(['--db','--manifest','--out','--passphrase-file','--archive'].includes(k)&&
   !Object.hasOwn(opts,k)&&typeof v==='string'&&v.length>0&&!v.startsWith('--'),
   'Unknown, duplicate or missing CLI option');
  opts[k]=v;
 }
 containsOnlyKnownArgs(mode,opts);
 return{mode,opts};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {mode,opts}=parseCLI(process.argv.slice(2));
  const result=mode==='seal'
   ?await sealSnapshot({backup:opts['--db'],manifest:opts['--manifest'],
      destination:opts['--out'],passphrasePath:opts['--passphrase-file']})
   :await unsealSnapshot({archive:opts['--archive'],destination:opts['--out'],
      passphrasePath:opts['--passphrase-file']});
  console.log(JSON.stringify({ok:true,...result},null,2));
 }catch(error){
  console.error('MARCOSA ENCRYPTED ARCHIVE BLOCKED: '+error.message);
  process.exitCode=1;
 }
}
