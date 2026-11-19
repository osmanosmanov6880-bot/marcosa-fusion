/**
 * R162 deterministic source evidence for a CI checkout. Hashes prove that a
 * LOCAL manifest matches LOCAL bytes, not that a reviewer approved production.
 * Independent remote signatures and staging readback remain mandatory.
 */
import {open,realpath,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {O_RDONLY,O_NOFOLLOW} from 'node:constants';

const REPO='osmanosmanov6880-bot/marcosa-fusion';
const REQUIRE=Object.freeze([
 'ops/r160/package-lock.json',
 'ops/r160/pg-driver.mjs',
 'ops/r160/staging-service.mjs',
 'ops/r161/sealed-config.mjs',
 'ops/r161/session-fenced-store.mjs',
 'ops/r161/tls-ingress.mjs',
 'ops/r161/webhook-inbox.mjs',
 'ops/r162/lifecycle.mjs',
 'ops/r162/recovery-supervisor.mjs',
 'ops/r162/release-evidence.mjs'
]);
export const R162_REQUIRED_FILES=REQUIRE;
const full=/^[a-f0-9]{40}$/;
const digest=s=>createHash('sha256').update(s).digest('hex');
const guard=(x,m)=>{if(!x)throw Error('R162 release: '+m);};
function context({repo,commit,root}){
 guard(repo===REPO,'unexpected source repository');
 guard(typeof commit==='string'&&full.test(commit),'full lowercase source SHA required');
 guard(typeof root==='string'&&resolve(root)===root,'absolute checkout required');
}
async function content(root,path){
 guard(typeof path==='string'&&
  /^(?:ops\/(?:r16[0-9]|r170|r171|r172|r173|r174|r175|test)\/|tests\/postgres\/)[a-z0-9._/-]+$/.test(path)&&
  !path.includes('..')&&!path.includes('//')&&!path.includes('/node_modules/')&&
  !/(?:secret|credential|private|\.pem|\.key|\.env)(?:\.|$)/.test(path),
  'unsafe source evidence path');
 const filename=join(root,path);
 // Forbid symlinked ancestors, not just a final O_NOFOLLOW check.
 let parent=dirname(filename);
 while(parent!==root){
  const s=await lstat(parent);
  guard(s.isDirectory()&&!s.isSymbolicLink(),'symlinked parent forbidden');
  parent=dirname(parent);
 }
 const stat=await lstat(filename);
 guard(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&
  stat.size>0&&stat.size<=262144,'unexpected source file size/type');
 const fd=await open(filename,O_RDONLY|O_NOFOLLOW);
 try{
  const data=await fd.readFile();
  guard(data.length===stat.size,'file changed during hashing');
  return Object.freeze({path,size:data.length,sha256:digest(data)});
 }finally{await fd.close();}
}
function canonical(manifest){
 const data={schemaVersion:1,repository:REPO,commit:manifest.commit,
  stage:'isolated-staging',files:manifest.files};
 return JSON.stringify(data);
}
export async function buildR162Evidence({root,repo=REPO,commit,files=REQUIRE}={}){
 context({root,repo,commit});
 guard(Array.isArray(files)&&files.length>=REQUIRE.length&&files.length<=90,
  'complete bounded file set required');
 const unique=[...new Set(files)];
 guard(unique.length===files.length&&REQUIRE.every(p=>unique.includes(p)),
  'missing mandatory file or duplicate');
 const canonicalRoot=await realpath(root);
 guard(canonicalRoot===root,'checkout symlink not allowed');
 const list=[];
 for(const file of unique.slice().sort())list.push(await content(root,file));
 const manifest={schemaVersion:1,repository:REPO,commit,
  stage:'isolated-staging',files:list};
 return Object.freeze({...manifest,manifestSha256:digest(canonical(manifest)),
  productionAuthorized:false,externalDeploymentVerified:false});
}
export async function verifyR162Evidence(manifest,{root,repo=REPO,commit}={}){
 context({root,repo,commit});
 guard(manifest&&typeof manifest==='object'&&!Array.isArray(manifest)&&
  Object.keys(manifest).length===8,'exact evidence contract required');
 guard(manifest.schemaVersion===1&&manifest.repository===REPO&&
  manifest.stage==='isolated-staging'&&manifest.commit===commit&&
  manifest.productionAuthorized===false&&
  manifest.externalDeploymentVerified===false,
  'evidence cannot authorize production');
 guard(Array.isArray(manifest.files)&&manifest.files.length>=REQUIRE.length&&
  manifest.files.length<=90&&manifest.files.every(f=>
   f&&typeof f.path==='string'&&typeof f.size==='number'&&
   typeof f.sha256==='string'&&/^[a-f0-9]{64}$/.test(f.sha256)&&
   Object.keys(f).sort().join(',')==='path,sha256,size'),
  'source listing invalid');
 const actual=await buildR162Evidence({root,repo,commit,
  files:manifest.files.map(f=>f.path)});
 const expected=Buffer.from(manifest.manifestSha256||'','hex');
 const hash=Buffer.from(actual.manifestSha256,'hex');
 guard(expected.length===hash.length&&timingSafeEqual(expected,hash),
  'manifest digest mismatch');
 guard(JSON.stringify(manifest.files)===JSON.stringify(actual.files),
  'source files modified since manifest');
 return Object.freeze({matchingLocalCheckout:true,
  productionAuthorized:false,independentReviewerApproved:false,
  sha256:actual.manifestSha256,fileCount:actual.files.length});
}
