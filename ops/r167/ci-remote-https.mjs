/**
 * R167 true loopback TLS/CA test of the native HTTPS remote-object adapter.
 * GitHub disposable CI only; NOT an external storage provider.
 */
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:https';
import {createHash,randomBytes} from 'node:crypto';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR167RemoteObjectStore} from './remote-object.mjs';

const check=(v,m)=>{if(!v)throw Error('R167 native HTTPS: '+m);};
check(process.env.GITHUB_ACTIONS==='true'&&
 process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion',
 'disposable GitHub CI only');
const work=await mkdtemp(join(tmpdir(),'r167-native-https-'));
async function certificate(name){
 const keyFile=join(work,name+'-private.key'),certFile=join(work,name+'-cert.pem');
 const p=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
  '-keyout',keyFile,'-out',certFile,'-days','2',
  '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],
  {encoding:'utf8',timeout:12000});
 check(p.status===0,'disposable TLS certificate generation failed');
 return{key:await readFile(keyFile,'utf8'),cert:await readFile(certFile,'utf8')};
}
const good=await certificate('good'),wrong=await certificate('wrong');
const token=randomBytes(48).toString('base64url');
const dump=Buffer.concat([Buffer.from('PGDMP'),randomBytes(1800)]);
const blob=sealR165Backup({plaintext:dump,key:randomBytes(32),
 commit:'a'.repeat(40),bundleSha256:'b'.repeat(64)}).blob;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=sha(blob);
const objects=new Map();
const server=createServer({key:good.key,cert:good.cert,minVersion:'TLSv1.2'},
 async(req,res)=>{
  const send=(status,headers={},body=Buffer.alloc(0))=>{
   if(res.writableEnded)return;
   res.writeHead(status,headers);res.end(body);
  };
  const match=/^\/v1\/archives\/([a-f0-9]{64})\.r165enc$/.exec(req.url||'');
  if(!match||req.headers.authorization!=='Bearer '+token){send(401);return;}
  const id=match[1];
  if(req.method==='PUT'){
   if(req.headers['if-none-match']!=='*'||req.headers['x-content-sha256']!==id||
    req.headers['content-type']!=='application/vnd.marcosa.r165enc'){
    send(400);return;
   }
   let total=0;const parts=[];
   for await(const part of req){
    total+=part.length;
    if(total>25*1024*1024+2048){send(413);return;}
    parts.push(part);
   }
   const content=Buffer.concat(parts);
   if(sha(content)!==id){send(422);return;}
   if(objects.has(id)){send(409);return;}
   objects.set(id,content);
   send(201,{'x-content-sha256':id,'x-write-once':'true'});return;
  }
  if(req.method==='GET'){
   if(id==='0'.repeat(64)){
    send(302,{location:'https://evil.example/steal'});return;
   }
   if(!objects.has(id)){send(404);return;}
   const content=objects.get(id);
   send(200,{'content-type':'application/vnd.marcosa.r165enc',
    'x-content-sha256':id,'content-length':content.length},content);
   return;
  }
  send(405);
 });
server.requestTimeout=5000;server.headersTimeout=6000;
let listening=false;
try{
 await new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'localhost',resolve);
 });listening=true;
 const origin='https://localhost:'+server.address().port+'/v1/archives/';
 const config={origin,expectedHost:'localhost',caPem:good.cert,token,
  allowNetwork:true,ciLoopback:true};
 const remote=createR167RemoteObjectStore(config);
 check((await remote.putEncrypted({blob,sha256:digest})).immutableReceipt,
  'remote service did not acknowledge original immutable put');
 const fetched=await remote.getEncrypted({sha256:digest});
 check(fetched.blob.equals(blob)&&fetched.verifiedContentAddress,
  'TLS remote ciphertext readback was not identical');
 let duplicateDenied=false,redirectDenied=false,wrongCertDenied=false;
 try{await remote.putEncrypted({blob,sha256:digest});}
 catch{duplicateDenied=true;}
 try{await remote.getEncrypted({sha256:'0'.repeat(64)});}
 catch{redirectDenied=true;}
 const corruptedCA=createR167RemoteObjectStore({...config,caPem:wrong.cert});
 try{await corruptedCA.getEncrypted({sha256:digest});}
 catch{wrongCertDenied=true;}
 check(duplicateDenied&&redirectDenied&&wrongCertDenied,
  'overwrite, HTTPS redirect or invalid trust root unexpectedly accepted');
 check(objects.size===1,'remote test server stored unexpected extra objects');
 console.log('R167_REAL_CA_VERIFIED_LOOPBACK_TLS_OBJECT_TRANSFER=PASS');
 console.log('R167_HTTPS_IMMUTABLE_PUT_REPLAY_REDIRECT_BAD_CA_DENIED=PASS');
 console.log('R167_REAL_REMOTE_PROVIDER_INDEPENDENTLY_AUDITED=NO_GO');
}finally{
 if(listening)await new Promise(ok=>server.close(()=>ok()));
 await rm(work,{recursive:true,force:true});
}
