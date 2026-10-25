#!/usr/bin/env node
// R106: trusted-source public readback ONLY for root-approved additive canary.
// Never accepts an arbitrary origin, credentials or production root mutation.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyManifest} from './pages-live-readback.mjs';

export const CANARY_BASE='https://marcosa.club/network-os/';
const SHA=/^[a-f0-9]{40}$/;
const MAX_BYTES=16*1024*1024;
const MAX_TOTAL=300*1024*1024;
const hex=data=>createHash('sha256').update(data).digest('hex');
function ensure(ok,message){if(!ok)throw Error(message);}
async function boundedFetch(url,expected,fetchFn){
  const response=await fetchFn(url,{method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',
    headers:{'Cache-Control':'no-store'},signal:AbortSignal.timeout(12000)});
  ensure(response.status===200&&!response.redirected,'Missing/redirected canary URL: '+url);
  if(response.url)ensure(response.url===url,'Cross-origin/path redirect not accepted');
  const route=new URL(url).pathname;
  let contentType=String(response.headers?.get('content-type')||'').toLowerCase().split(';')[0].trim();
  if(route.endsWith('.html')||route===new URL(CANARY_BASE).pathname)
    ensure(contentType==='text/html','Canary HTML MIME mismatch');
  if(route.endsWith('.css'))ensure(contentType==='text/css','Canary CSS MIME mismatch');
  if(route.endsWith('.js')||route.endsWith('.mjs'))
    ensure(contentType.includes('javascript'),'Canary JS MIME mismatch');
  const size=Number(response.headers?.get('content-length')||0);
  ensure(Number.isSafeInteger(size)&&size>=0&&size<=MAX_BYTES,'Canary Content-Length invalid');
  ensure(response.body,'Empty canary response stream');
  let total=0;
  const chunks=[];
  for await(const chunk of response.body){
    const b=Buffer.from(chunk);
    total+=b.length;
    ensure(total<=MAX_BYTES,'Canary resource exceeds safe limit');
    chunks.push(b);
  }
  const bytes=Buffer.concat(chunks);
  ensure(total>0&&hex(bytes)===expected,'Canary remote bytes are stale/mismatched: '+route);
  return total;
}
export async function verifyCanary({trustedManifestBytes,sourceSha,fetchFn=globalThis.fetch}={}){
  ensure(SHA.test(sourceSha||''),'Exact signed source SHA required');
  ensure(typeof fetchFn==='function','HTTPS client unavailable');
  const {assets}=verifyManifest(trustedManifestBytes);
  const url=CANARY_BASE+'?marcosa_canary='+sourceSha;
  let total=await boundedFetch(url,assets['index.html'],fetchFn);
  const entries=Object.entries(assets);
  let next=0,verified=0;
  await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
    while(next<entries.length){
      const [name,digest]=entries[next++];
      const remote=CANARY_BASE+name+'?marcosa_canary='+sourceSha;
      total+=await boundedFetch(remote,digest,fetchFn);
      ensure(total<=MAX_TOTAL,'Aggregate public canary response exceeds size limit');
      verified++;
    }
  }));
  ensure(verified===entries.length,'Incomplete canary verification');
  return {status:'PASS',verifiedAssets:verified,sourceSha,
    url:CANARY_BASE,additiveCanaryOnly:true,productionRootModified:false,
    authenticatedProductionVerified:false};
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--manifest'||args[2]!=='--sha')
    throw Error('usage: --manifest build-manifest.json --sha 40-character-source-sha');
  const result=await verifyCanary({trustedManifestBytes:readFileSync(args[1]),sourceSha:args[3]});
  console.log(JSON.stringify(result));
  console.log('PUBLIC_CANARY_HTTPS=PASS');
  console.log('PUBLIC_CANARY_ASSETS_VERIFIED='+result.verifiedAssets);
  console.log('LEGACY_PRODUCTION_UNCHANGED=YES');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}
  catch(e){console.error('PUBLIC_CANARY_HTTPS=FAIL '+String(e.message||e));process.exitCode=2;}
}
