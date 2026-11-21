import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {X509Certificate,randomBytes,createHash} from 'node:crypto';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR167RemoteObjectStore} from '../r167/remote-object.mjs';
const caPem=rootCertificates.find(s=>{const c=new X509Certificate(s),n=Date.now();
 return Date.parse(c.validFrom)<=n&&Date.parse(c.validTo)>n;});
const token='fake-r167-staging-operator-only-receiver-token-do-not-use-live-123456';
const data=sealR165Backup({plaintext:Buffer.concat([Buffer.from('PGDMP'),randomBytes(1200)]),
 key:randomBytes(32),commit:'a'.repeat(40),bundleSha256:'b'.repeat(64)}).blob;
const digest=createHash('sha256').update(data).digest('hex');
function store(responseOverride){
 const calls=[];
 const client=createR167RemoteObjectStore({
  origin:'https://objects.staging.example/v1/archives/',
  expectedHost:'objects.staging.example',caPem,token,allowNetwork:true,
  sendWire:async(url,options)=>{
   calls.push({url:url.toString(),options});
   if(responseOverride)return responseOverride(url,options);
   return options.method==='PUT'?
    {status:201,headers:{'x-content-sha256':digest,'x-write-once':'true'},body:Buffer.alloc(0)}:
    {status:200,headers:{'x-content-sha256':digest,
     'content-type':'application/vnd.marcosa.r165enc'},body:data};
  }
 });
 return{client,calls};
}
test('R167 HTTPS write-once upload, content-addressed readback and strict headers',async()=>{
 const {client,calls}=store();
 assert.equal((await client.putEncrypted({blob:data,sha256:digest})).immutableReceipt,true);
 const returned=await client.getEncrypted({sha256:digest});
 assert.ok(returned.blob.equals(data));assert.equal(calls.length,2);
 assert.ok(calls[0].url.endsWith('/'+digest+'.r165enc'));
 assert.equal(calls[0].options.headers['if-none-match'],'*');
 assert.match(calls[0].options.headers.authorization,/^Bearer fake/);
 assert.equal(client.publicStatus().productionAuthorized,false);
});
test('R167 rejects HTTP, redirects, forged receipt, digest mismatch, insecure auth',async()=>{
 const args={origin:'https://objects.staging.example/v1/archives/',
  expectedHost:'objects.staging.example',caPem,token};
 for(const changes of [
  {origin:'http://objects.staging.example/v1/archives/'},
  {origin:'https://objects.staging.example/other/'},
  {origin:'https://objects.staging.example/v1/archives/?redirect=evil'},
  {expectedHost:'attacker.example'},{token:'short'},
  {caPem:'BAD CERT'}
 ])assert.throws(()=>createR167RemoteObjectStore({...args,...changes}),/R167 remote object/);
 const {client}=store(()=>({status:302,headers:{location:'https://evil.example'},body:Buffer.alloc(0)}));
 await assert.rejects(client.putEncrypted({blob:data,sha256:digest}),/immutable receipt/);
 await assert.rejects(client.getEncrypted({sha256:digest}),/complete remote/);
 await assert.rejects(client.putEncrypted({blob:data,sha256:'0'.repeat(64)}),/expected digest/);
 const bad=store(()=>({status:200,headers:{'x-content-sha256':digest,
  'content-type':'application/vnd.marcosa.r165enc'},body:Buffer.from(data.subarray(0,data.length-1))}));
 await assert.rejects(bad.client.getEncrypted({sha256:digest}),/blob changed/);
});
test('R167 external side effects are disabled by default',async()=>{
 const client=createR167RemoteObjectStore({
  origin:'https://objects.staging.example/v1/archives/',
  expectedHost:'objects.staging.example',caPem,token});
 await assert.rejects(client.putEncrypted({blob:data,sha256:digest}),/disabled/);
});
