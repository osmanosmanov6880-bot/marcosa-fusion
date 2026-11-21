/**
 * R161 operator-only staging configuration.
 * Nothing reads environment secrets or accepts world-readable/symlinked files.
 * A reviewed operator provides all values in a private root; no process starts.
 */
import {open,realpath,stat} from 'node:fs/promises';
import {O_RDONLY,O_NOFOLLOW} from 'node:constants';
import {basename,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createR160StagingService} from '../r160/staging-service.mjs';
import {createR160ControlPlane} from '../r160/control-plane.mjs';

const guard=(v,m)=>{if(!v)throw Error('R161 sealed config: '+m);};
const secretName=/^[a-z][a-z0-9-]{2,48}\.(?:pem|txt)$/;
const permitted=new Set(['staging','projectRef','allowedOrigins','database','secrets']);
const dbFields=new Set(['host','port','name','role','maxConnections']);
const secretFields=new Set(['ca','password','operatorToken','webhookSecret']);
async function readOwnedFile(root,name,limit=16384){
 guard(typeof name==='string'&&secretName.test(name)&&basename(name)===name,
  'secret file name must be a safe basename');
 const filepath=join(root,name);
 let fd;
 try{
  fd=await open(filepath,O_RDONLY|O_NOFOLLOW);
  const info=await fd.stat();
  guard(info.isFile()&&info.nlink===1&&info.size>0&&info.size<=limit,
   'secret must be a bounded, non-hardlinked file');
  guard((info.mode&0o077)===0,'group or world access forbidden');
  if(typeof process.getuid==='function')
   guard(info.uid===process.getuid(),'secret file must belong to active operator');
  const text=await fd.readFile({encoding:'utf8'});
  guard(text.length>0&&!text.includes('\0'),'empty or binary secret');
  return text;
 }catch{throw Error('R161 sealed config: secure file unavailable or unsafe');}
 finally{if(fd)await fd.close();}
}
export async function readSealedR161Settings({secretsRoot,manifestName='staging.txt'}={}){
 guard(typeof secretsRoot==='string'&&resolve(secretsRoot)===secretsRoot,
  'absolute secret directory required');
 guard(manifestName==='staging.txt','fixed manifest basename required');
 let root;
 try{
  const original=await stat(secretsRoot);
  root=await realpath(secretsRoot);
  guard(original.isDirectory()&&root===secretsRoot,
   'secret root must be a canonical directory');
  guard((original.mode&0o077)===0,'secret root must be private');
  if(typeof process.getuid==='function')
   guard(original.uid===process.getuid(),'secret root must belong to operator');
 }catch{throw Error('R161 sealed config: private secret root required');}
 let config;
 try{
  const raw=await readOwnedFile(root,manifestName,8192);
  config=JSON.parse(raw);
 }catch{throw Error('R161 sealed config: manifest must be safe JSON');}
 guard(config&&typeof config==='object'&&!Array.isArray(config)&&
  Object.keys(config).length===permitted.size&&
  Object.keys(config).every(k=>permitted.has(k)),'unexpected manifest fields');
 guard(config.staging===true,'only sealed staging allowed');
 guard(typeof config.projectRef==='string'&&/^[a-z0-9]{20,32}$/.test(config.projectRef),
  'project ref invalid');
 guard(Array.isArray(config.allowedOrigins)&&config.allowedOrigins.length>=1&&
  config.allowedOrigins.length<=3&&config.allowedOrigins.every(x=>
  typeof x==='string'&&/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(x)),
  'operator-approved HTTPS origin required');
 guard(config.database&&Object.getPrototypeOf(config.database)===Object.prototype&&
  Object.keys(config.database).length===dbFields.size&&
  Object.keys(config.database).every(k=>dbFields.has(k)),'database contract invalid');
 guard(config.secrets&&Object.getPrototypeOf(config.secrets)===Object.prototype&&
  Object.keys(config.secrets).length===secretFields.size&&
  Object.keys(config.secrets).every(k=>secretFields.has(k)),'secret file contract invalid');
 const {host,port,name,role,maxConnections}=config.database;
 guard(typeof host==='string'&&/^[a-z0-9.-]{4,253}$/i.test(host)&&!host.includes('..')&&
  !['localhost','127.0.0.1','0.0.0.0'].includes(host),'remote pinned database host required');
 guard(Number.isInteger(port)&&port>0&&port<=65535,'database port invalid');
 guard(typeof name==='string'&&/^[a-z][a-z0-9_]{2,63}$/.test(name),'database name invalid');
 guard(typeof role==='string'&&/^[a-z][a-z0-9_.-]{3,100}$/.test(role),
  'database role invalid');
 guard(Number.isInteger(maxConnections)&&maxConnections>=1&&maxConnections<=8,
  'bounded connection count required');
 const [caPem,password,adminToken,webhookSecret]=await Promise.all([
  readOwnedFile(root,config.secrets.ca),
  readOwnedFile(root,config.secrets.password,1024),
  readOwnedFile(root,config.secrets.operatorToken,512),
  readOwnedFile(root,config.secrets.webhookSecret,512)
 ]);
 guard(adminToken.trim().length>=32&&adminToken.trim().length<=128,
  'strong operator token required');
 guard(webhookSecret.trim().length>=32,'strong webhook signing key required');
 const pgConfig=Object.freeze({host,expectedHost:host,port,database:name,user:role,
  maxConnections,password:password.trim(),caPem:caPem.trim()});
 const settings=Object.freeze({stage:'staging',projectRef:config.projectRef,
  allowedOrigins:Object.freeze([...config.allowedOrigins]),maxPreflightAgeMs:15000});
 const fingerprint=createHash('sha256').update(JSON.stringify({
  projectRef:config.projectRef,host,port,name,role,
  allowedOrigins:config.allowedOrigins
 })).digest('hex').slice(0,20);
 return Object.freeze({
  pgConfig,settings,operatorToken:adminToken.trim(),webhookSecret:webhookSecret.trim(),
  publicMetadata:Object.freeze({stage:'staging',fingerprint,
   secretCount:4,productionReady:false,liveDatabaseConnected:false})
 });
}
export async function assembleSealedR161Staging({secretsRoot,jwksFetch}={}){
 const bundle=await readSealedR161Settings({secretsRoot});
 const runtime=createR160StagingService({
  pgConfig:bundle.pgConfig,settings:bundle.settings,jwksFetch
 });
 const control=createR160ControlPlane({runtime,adminToken:bundle.operatorToken});
 return Object.freeze({runtime,control,publicMetadata:bundle.publicMetadata});
}
