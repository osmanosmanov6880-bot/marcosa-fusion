import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyCanary,CANARY_BASE} from '../ops/verify_canary_live_https.mjs';

const sha='a'.repeat(40),hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const files=new Map([
  ['index.html',Buffer.from('<html>Canary</html>')],
  ['network.js',Buffer.from('console.log("canary")')],
  ['network.css',Buffer.from('body{color:white}')],
  ['social.html',Buffer.from('<html>Community</html>')]
 ]);
 const manifest=Buffer.from(JSON.stringify({release_kind:'public_static_preview_only',
    files:Object.fromEntries([...files].map(([n,b])=>[n,hash(b)]))}));
 const fetchFn=async (url,opts)=>{
  assert.equal(opts.redirect,'manual');
  const u=new URL(url);
  assert.equal(u.origin,'https://marcosa.club');
  assert.ok(u.pathname.startsWith('/network-os/'));
  assert.equal(u.searchParams.get('marcosa_canary'),sha);
  const path=u.pathname==='/network-os/'?'index.html':u.pathname.replace('/network-os/','');
  const data=files.get(path);
  if(!data)return new Response('not found',{status:404});
  let contentType=path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html';
  return new Response(data,{status:200,headers:{'content-type':contentType,'content-length':data.length}});
 };
 return {manifest,files,fetchFn};
}
test('R106: verify every HTTP asset including /network-os/ index from trusted same-run manifest',async()=>{
 const x=fixture();
 const r=await verifyCanary({trustedManifestBytes:x.manifest,sourceSha:sha,fetchFn:x.fetchFn});
 assert.equal(r.status,'PASS');assert.equal(r.verifiedAssets,4);
 assert.equal(r.url,CANARY_BASE);
 assert.equal(r.productionRootModified,false);
 assert.equal(r.authenticatedProductionVerified,false);
});
test('R106: corrupted hosted JavaScript fails',async()=>{
 const x=fixture();
 const bad=async (url,opts)=>{
  if(new URL(url).pathname.endsWith('network.js'))
   return new Response('old JS',{status:200,headers:{'content-type':'text/javascript'}});
  return x.fetchFn(url,opts);
 };
 await assert.rejects(verifyCanary({trustedManifestBytes:x.manifest,sourceSha:sha,fetchFn:bad}),/stale\/mismatched/);
});
test('R106: missing frontend route fails, no successful claim',async()=>{
 const x=fixture();
 const missing=async (url,opts)=>{
  if(new URL(url).pathname.endsWith('/social.html'))
   return new Response('not found',{status:404});
  return x.fetchFn(url,opts);
 };
 await assert.rejects(verifyCanary({trustedManifestBytes:x.manifest,sourceSha:sha,fetchFn:missing}),/Missing\/redirected/);
});
test('R106: reject wrong commit identity and HTML MIME spoof',async()=>{
 const x=fixture();
 await assert.rejects(verifyCanary({trustedManifestBytes:x.manifest,sourceSha:'wrong',fetchFn:x.fetchFn}),/Exact signed source SHA/);
 const malformed=async(url,opts)=>{
  if(new URL(url).pathname==='/network-os/')return new Response('HTML',{status:200,headers:{'content-type':'text/plain'}});
  return x.fetchFn(url,opts);
 };
 await assert.rejects(verifyCanary({trustedManifestBytes:x.manifest,sourceSha:sha,fetchFn:malformed}),/HTML MIME mismatch/);
});
