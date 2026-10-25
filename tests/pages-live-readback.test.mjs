import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyManifest,verifyPublicPages,PAGES_ORIGIN,PAGES_PREFIX} from '../ops/pages-live-readback.mjs';
const sha256 = raw=>createHash('sha256').update(raw).digest('hex');
const sourceSha='a'.repeat(40);
function fixture(){
 const assets=new Map([
  ['index.html',Buffer.from('<html>TEST</html>')],
  ['network.css',Buffer.from('body{color:blue}')],
  ['network.js',Buffer.from('console.log("qa");')],
  ['social.html',Buffer.from('<html>Social</html>')]
 ]);
 const manifest=Buffer.from(JSON.stringify({release_kind:'public_static_preview_only',
  files:Object.fromEntries([...assets].map(([p,b])=>[p,sha256(b)]))})+'\n');
 assets.set('build-manifest.json',manifest);
 const fn=async url=>{
  const u=new URL(url);
  assert.equal(u.origin,PAGES_ORIGIN);
  assert.ok(u.pathname.startsWith(PAGES_PREFIX));
  assert.equal(u.searchParams.get('marcosa_release'),sourceSha);
  const path=u.pathname.slice(PAGES_PREFIX.length);
  const bytes=assets.get(path);
  if(!bytes)return new Response('not found',{status:404});
  const mime=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':
   path.endsWith('.json')?'application/json':'text/html';
  return new Response(bytes,{status:200,headers:{'content-type':mime,'content-length':String(bytes.length)}});
 };
 return {assets,manifest,fn};
}
test('R103: public HTTPS readback pins host/path and verifies all assets against independent manifest',async()=>{
 const f=fixture();
 const r=await verifyPublicPages({trustedManifestBytes:f.manifest,sourceSha,fetchFn:f.fn});
 assert.equal(r.verified,true);
 assert.equal(r.assetsVerified,4);
 assert.equal(r.sourceSha,sourceSha);
 assert.equal(r.publicUrl,PAGES_ORIGIN+PAGES_PREFIX);
 assert.equal(r.productionAuthorized,false);
});
test('R103: reject corrupt remote JS',async()=>{
 const f=fixture();
 const corrupted=async url=>{
  if(new URL(url).pathname.endsWith('network.js'))
    return new Response('stale js',{status:200,headers:{'content-type':'text/javascript'}});
  return f.fn(url);
 };
 await assert.rejects(verifyPublicPages({trustedManifestBytes:f.manifest,sourceSha,fetchFn:corrupted}),
  /Published bytes stale or mismatched/);
});
test('R103: reject mismatched public manifest before comparing assets',async()=>{
 const f=fixture();
 const modified=async url=>{
  if(new URL(url).pathname.endsWith('build-manifest.json'))
   return new Response('{"wrong":true}',{status:200,headers:{'content-type':'application/json'}});
  return f.fn(url);
 };
 await assert.rejects(verifyPublicPages({trustedManifestBytes:f.manifest,sourceSha,fetchFn:modified}),
  /manifest does not match/);
});
test('R103: reject redirects, invalid SHA, and attempted traversal filenames',async()=>{
 const f=fixture();
 await assert.rejects(verifyPublicPages({trustedManifestBytes:f.manifest,sourceSha:'bad',fetchFn:f.fn}),
  /Trusted exact main commit/);
 const hostile=Buffer.from(JSON.stringify({release_kind:'public_static_preview_only',files:{
  'index.html':'1'.repeat(64),'network.js':'2'.repeat(64),'network.css':'3'.repeat(64),
  '../secrets.json':'4'.repeat(64)}}));
 assert.throws(()=>verifyManifest(hostile),/Unsafe public manifest/);
 const redirected=async()=>Response.redirect('https://other.example/path',302);
 await assert.rejects(verifyPublicPages({trustedManifestBytes:f.manifest,sourceSha,fetchFn:redirected}),
  /not available|redirected/);
});
