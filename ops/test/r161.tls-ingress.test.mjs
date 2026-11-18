import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {createR161TlsIngress} from '../r161/tls-ingress.mjs';

const host='staging.marcosa.example';
async function cert(){
 const root=await mkdtemp(join(tmpdir(),'r161-tls-'));
 const args=['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),
  '-out',join(root,'cert.pem'),'-days','2','-subj','/CN='+host,
  '-addext','subjectAltName=DNS:'+host];
 const result=spawnSync('openssl',args,{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return{certPem:await readFile(join(root,'cert.pem'),'utf8'),
  keyPem:await readFile(join(root,'key.pem'),'utf8'),
  cleanup:()=>rm(root,{recursive:true,force:true})};
}
async function call(port,ca,{origin='https://'+host,hostHeader=host,
 servername=host,method='POST',path='/v1/series/16100000-0000-4161-8161-000000000003/edit',
 extraHeaders={},payload={revision:0,title:'TLS checked',description:'ok'}}={}){
 const body=JSON.stringify(payload);
 return new Promise((resolve,reject)=>{
  const req=httpsRequest({hostname:'127.0.0.1',servername,port,method,path,ca,
   rejectUnauthorized:true,headers:{
    Host:hostHeader,Origin:origin,'Content-Type':'application/json',
    'Content-Length':Buffer.byteLength(body),
    Authorization:'Bearer '+('x'.repeat(64)),
    'X-Idempotency-Key':'16100000-0000-4161-8161-000000000004',
    ...extraHeaders
   }},res=>{
    let b='';res.on('data',x=>b+=x);res.on('end',()=>resolve({code:res.statusCode,body:b}));
   });
  req.on('error',reject);req.end(body);
 });
}
test('R161 actual HTTPS accepts only verified SNI+Host+Origin and safe command headers',async()=>{
 const c=await cert(),upstream=createServer(async(req,res)=>{
  let s='';for await(const chunk of req)s+=chunk;
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({ok:true,origin:req.headers.origin,host:req.headers.host,
   cookie:req.headers.cookie||null,bodyLength:s.length}));
 });
 await new Promise(ok=>upstream.listen(0,'127.0.0.1',ok));
 const edge=createR161TlsIngress({...c,hostname:host,upstreamPort:upstream.address().port});
 try{
  const addr=await edge.listen();
  const accepted=await call(addr.port,c.certPem);
  assert.equal(accepted.code,200);
  const body=JSON.parse(accepted.body);
  assert.equal(body.origin,'https://'+host);
  assert.match(body.host,/^127\.0\.0\.1:/);
  assert.equal(body.cookie,null);
  assert.equal((await call(addr.port,c.certPem,{origin:'https://attacker.invalid'})).code,403);
  assert.equal((await call(addr.port,c.certPem,{hostHeader:'attacker.invalid'})).code,403);
  assert.equal((await call(addr.port,c.certPem,{extraHeaders:{'X-Forwarded-For':'1.2.3.4'}})).code,400);
  assert.equal((await call(addr.port,c.certPem,{method:'GET'})).code,404);
  assert.equal((await call(addr.port,c.certPem,{path:'/v1/evil'})).code,404);
  assert.equal(edge.status().forwarded,1);
  assert.equal(edge.status().productionReady,false);
  await assert.rejects(call(addr.port,'-----BEGIN CERTIFICATE-----\nBAD\n-----END CERTIFICATE-----'),
   /certificate|PEM|unable|self.signed/i);
  await assert.rejects(call(addr.port,c.certPem,{servername:'attacker.invalid'}),/hostname|altname|certificate/i);
 }finally{await edge.close();await new Promise(ok=>upstream.close(ok));await c.cleanup();}
});
test('R161 edge rejects missing trust materials and external listen addresses',async()=>{
 assert.throws(()=>createR161TlsIngress({hostname:host,upstreamPort:3000,
  certPem:'garbage',keyPem:'garbage'}),/certificate/);
 const c=await cert();
 const e=createR161TlsIngress({...c,hostname:host,upstreamPort:3000});
 await assert.rejects(e.listen({host:'0.0.0.0'}),/loopback-only/);
 await e.close();await c.cleanup();
});
