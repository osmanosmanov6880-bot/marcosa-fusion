import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {createR163StagingReadback,r163SpkiFingerprint} from '../r163/staging-readback.mjs';

const cert=rootCertificates.find(x=>{try{const c=new X509Certificate(x),n=Date.now();
 return Date.parse(c.validFrom)<=n&&n<Date.parse(c.validTo);}catch{return false;}});
assert.ok(cert);
const origin='https://stage.example.invalid',commit='a'.repeat(40),hash='b'.repeat(64);
const args=()=>({origin,caPem:cert,expectedSpki:r163SpkiFingerprint(cert)});
function wire(modify){
 return async({nonce,hostname})=>{
  assert.equal(hostname,'stage.example.invalid');
  const proof={schemaVersion:1,service:'marcosa-fusion',stage:'isolated-staging',
   commit,bundleSha256:hash,nonce,productionReady:false};
  return modify?.({proof,nonce})||{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store'},
   body:Buffer.from(JSON.stringify(proof))};
 };
}
test('R163 pinned readback verifies fresh nonce, exact SHA and no production claim',async()=>{
 const result=await createR163StagingReadback({
  ...args(),transport:wire()}).probe({commit,bundleSha256:hash});
 assert.equal(result.readbackMatched,true);
 assert.equal(result.productionAuthorized,false);
 assert.equal(result.pinnedTlsTransportUsed,false);
 assert.equal(result.syntheticCiLoopback,false);
});
test('R163 replay, altered source, redirects, caching and oversized reply rejected',async()=>{
 const invalid=[
  wire(({proof})=>({status:200,headers:{'content-type':'application/json',
   'cache-control':'no-store'},body:Buffer.from(JSON.stringify({...proof,nonce:'f'.repeat(32)}))})),
  wire(({proof})=>({status:200,headers:{'content-type':'application/json',
   'cache-control':'no-store'},body:Buffer.from(JSON.stringify({...proof,commit:'f'.repeat(40)}))})),
  wire(()=>({status:302,headers:{location:'https://evil.invalid'},body:Buffer.from('{}')})),
  wire(({proof})=>({status:200,headers:{'content-type':'application/json'},
   body:Buffer.from(JSON.stringify(proof))})),
  wire(()=>({status:200,headers:{'content-type':'application/json',
   'cache-control':'no-store'},body:Buffer.alloc(5000,'a')}))
 ];
 for(const transport of invalid)
  await assert.rejects(createR163StagingReadback({...args(),transport})
   .probe({commit,bundleSha256:hash}),/R163 readback/);
});
test('R163 forbids arbitrary destinations, local production endpoints and invalid TLS roots',()=>{
 for(const opt of [
  {origin:'http://stage.example.invalid'},
  {origin:'https://stage.example.invalid/path'},
  {origin:'https://stage.example.invalid:8443'},
  {origin:'https://127.0.0.1'},
  {connectHost:'127.0.0.1'},
  {caPem:'bad'},
  {expectedSpki:'untrusted'}
 ])assert.throws(()=>createR163StagingReadback({...args(),...opt}),/R163 readback/);
});
