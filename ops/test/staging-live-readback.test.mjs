import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {makeStagingAttestation,sha256,FORMAT} from '../staging-release-attestation.mjs';
import {requireStagingOrigin,verifyHostedStaging} from '../staging-live-readback.mjs';

const SHA='a'.repeat(40),HOST='staging.marcosa.example.com',ORIGIN='https://'+HOST;
const MIME={'staging-release.json':'application/json','build-manifest.json':'application/json',
 'index.html':'text/html','network.js':'application/javascript','network.css':'text/css'};
function fixture(){
 const html=Buffer.from('<!doctype html><html><title>MARCOSA</title><main>Real static preview</main></html>');
 const js=Buffer.from('document.documentElement.dataset.site="MARCOSA";');
 const css=Buffer.from('body{color:rgb(255,255,255)}');
 const assets={'index.html':html,'network.js':js,'network.css':css};
 const man=Buffer.from(JSON.stringify({release_kind:'public_static_preview_only',
  files:Object.fromEntries(Object.entries(assets).map(([p,buf])=>[p,sha256(buf)]))}));
 const att=makeStagingAttestation({sourceSha:SHA,manifestBytes:man});
 const map=new Map([['staging-release.json',Buffer.from(JSON.stringify(att))],
  ['build-manifest.json',man],...Object.entries(assets)]);
 const calls=[];
 async function fetchFn(url,init){
  const u=new URL(url),path=u.pathname.slice(1);calls.push({url,init});
  if(!map.has(path))return new Response('missing',{status:404});
  return new Response(map.get(path),{status:200,
   headers:{'content-type':MIME[path]}});
 }
 return {man,att,map,fetchFn,calls};
}
async function verify(f,params={}){
 return verifyHostedStaging({origin:ORIGIN,expectedHost:HOST,
  sourceSha:SHA,expectedManifestSha256:sha256(f.man),fetchFn:f.fetchFn,...params});
}
test('R90 deterministic content-addressed staging attestation never grants production',()=>{
 const f=fixture();
 assert.equal(f.att.format,FORMAT);
 assert.equal(f.att.sourceSha,SHA);
 assert.equal(f.att.assetsCount,3);
 assert.equal(f.att.buildManifestSha256,sha256(f.man));
 assert.equal(f.att.productionAuthorized,false);
 assert.throws(()=>makeStagingAttestation({sourceSha:'wrong',manifestBytes:f.man}),/40-character/);
 assert.throws(()=>makeStagingAttestation({sourceSha:SHA,manifestBytes:Buffer.from('{}')}),/manifest/);
 const tampered=Buffer.from(JSON.stringify({release_kind:'public_static_preview_only',
  files:{'index.html':'0'.repeat(64),'network.js':'0'.repeat(64),'../secret':'0'.repeat(64)}}));
 assert.throws(()=>makeStagingAttestation({sourceSha:SHA,manifestBytes:tampered}));
});
test('R90 real-mode HTTPS byte readback checks the publicly served payload not a symlink or workflow conclusion',async()=>{
 const f=fixture(),proof=await verify(f);
 assert.equal(proof.verified,true);
 assert.equal(proof.reviewedSourceSha,SHA);
 assert.equal(proof.filesMatched.length,3);
 assert.equal(proof.reviewedBuildManifestSha256,sha256(f.man));
 assert.equal(proof.productionAuthorized,false);
 assert.equal(proof.providerHostKeyVerified,false);
 assert.equal(f.calls.length,5);
 for(const q of f.calls){
  assert.equal(q.init.redirect,'manual');assert.equal(q.init.credentials,'omit');
  assert.equal(q.init.cache,'no-store');
  const u=new URL(q.url);assert.equal(u.origin,ORIGIN);
  assert.equal(u.searchParams.get('marcosa_release'),SHA);
 }
});
test('R90 refuse unsafe DNS host, off-host origin, ambiguous or insecure URL',()=>{
 const denied=['http://'+HOST,'https://127.0.0.1','https://localhost',
  'https://localhost.local','https://internal.test','https://example.com/secret',
  'https://user:secret@'+HOST,'https://'+HOST+'?auth=token',
  'https://'+HOST+'#hash','https://'+HOST+':444'];
 for(const u of denied)assert.throws(()=>requireStagingOrigin(u,HOST),undefined,u);
 assert.equal(requireStagingOrigin(ORIGIN,HOST),ORIGIN);
 assert.throws(()=>requireStagingOrigin(ORIGIN,'attacker.example.com'),/hostname differs/);
});
test('R90 refuses fully forged matching hosted evidence without trusted CI manifest digest',async()=>{
 const f=fixture(),index=Buffer.from('Forged HTML');
 const man=Buffer.from(JSON.stringify({release_kind:'public_static_preview_only',files:{
  'index.html':sha256(index),'network.js':sha256(f.map.get('network.js')),
  'network.css':sha256(f.map.get('network.css'))}}));
 f.map.set('index.html',index);f.map.set('build-manifest.json',man);
 f.map.set('staging-release.json',Buffer.from(JSON.stringify(makeStagingAttestation({sourceSha:SHA,manifestBytes:man}))));
 await assert.rejects(()=>verify(f),/trusted build-manifest SHA256/);
 await assert.rejects(()=>verify(f,{expectedManifestSha256:undefined}),/Independent trusted/);
});
test('R90 refuse stale commit attestation and swapped build manifest despite all files being present',async()=>{
 let f=fixture();
 f.map.set('staging-release.json',Buffer.from(JSON.stringify({...f.att,sourceSha:'b'.repeat(40)})));
 await assert.rejects(()=>verify(f),/Source SHA/);
 f=fixture();f.map.set('build-manifest.json',Buffer.from(f.man.toString()+' '));
 await assert.rejects(()=>verify(f),/build-manifest bytes mismatch/);
 f=fixture();f.map.set('network.js',Buffer.from('COMPROMISED STALE OLD BUILD'));
 await assert.rejects(()=>verify(f),/Stale or corrupt hosted bytes: network.js/);
 f=fixture();f.map.set('index.html',Buffer.from('THIS IS A DIFFERENT INDEX'));
 await assert.rejects(()=>verify(f),/Stale or corrupt hosted bytes: index.html/);
});
test('R90 fail closed for redirect, missing asset, wrong MIME and malicious oversized responses',async()=>{
 let f=fixture();
 const original=f.fetchFn;
 f.fetchFn=async (url,opts)=>new URL(url).pathname.endsWith('/index.html')?
  new Response('',{status:302,headers:{location:'https://attacker.invalid'}}):
  original(url,opts);
 await assert.rejects(()=>verify(f),/redirected or not HTTP 200/);
 f=fixture();f.map.delete('staging-release.json');
 await assert.rejects(()=>verify(f),/Hosted file unavailable/);
 f=fixture();f.map.set('index.html',Buffer.alloc(2097153,1));
 await assert.rejects(()=>verify(f),/exceeds size limit/);
 f=fixture();const f0=f.fetchFn;
 f.fetchFn=async(url,opts)=>{
  const result=await f0(url,opts);
  if(new URL(url).pathname==='/build-manifest.json')
   return new Response(f.man,{headers:{'content-type':'text/html'}});
  return result;
 };
 await assert.rejects(()=>verify(f),/wrong MIME type/);
});
test('R90 CLI write is create-only, proper SHA and safe manifest data, never overwrites',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r90-proof-'));
 try{
  const f=fixture(),manifest=join(dir,'build-manifest.json'),dest=join(dir,'staging-release.json');
  writeFileSync(manifest,f.man);
  const args=['ops/staging-release-attestation.mjs','--sha',SHA,'--manifest',manifest,'--output',dest];
  const one=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(one.status,0,one.stderr);
  const published=JSON.parse(readFileSync(dest,'utf8'));
  assert.equal(published.sourceSha,SHA);
  assert.equal(published.buildManifestSha256,sha256(f.man));
  const two=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(two.status,2,'Second run must not overwrite first attestation');
  assert.equal(JSON.parse(readFileSync(dest,'utf8')).sourceSha,SHA);
 }finally{rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});}
});
