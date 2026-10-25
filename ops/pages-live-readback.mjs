#!/usr/bin/env node
/**
 * R103: independently check PUBLIC GitHub Pages bytes against a manifest from
 * the same trusted GitHub Actions build (not a manifest trusted from the site).
 * HTTPS host/base path are hard-pinned. No auth, private keys or production writes.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PAGES_ORIGIN = 'https://osmanosmanov6880-bot.github.io';
export const PAGES_PREFIX = '/marcosa-fusion/';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const MAX_ITEM = 16 * 1024 * 1024;
const MAX_TOTAL = 320 * 1024 * 1024;
const VALID_PATH = /^[A-Za-z0-9][A-Za-z0-9/_+.-]{0,180}\.(?:html|htm|js|mjs|css|svg|png|jpe?g|webp|json)$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const requireOk = (ok,msg) => {if(!ok)throw Error(msg);};

export function verifyManifest(bytes) {
  requireOk(Buffer.isBuffer(bytes) && bytes.length < 2*1024*1024,'Trusted build-manifest bytes missing or excessive');
  const m=JSON.parse(bytes.toString('utf8'));
  requireOk(m?.release_kind==='public_static_preview_only','This URL is only a static preview');
  const assets=m?.files;
  requireOk(assets&&typeof assets==='object'&&!Array.isArray(assets),'Missing trusted manifest');
  const items=Object.entries(assets);
  requireOk(items.length>=3&&items.length<=5000,'Unexpected manifest size');
  for(const [name,sha] of items){
    requireOk(VALID_PATH.test(name)&& !name.includes('..') && !name.includes('//') &&
      SHA64.test(sha),'Unsafe public manifest asset path/digest');
  }
  for(const n of ['index.html','network.js','network.css'])
    requireOk(SHA64.test(assets[n]||''),'Missing core preview asset');
  return {assets,sourceManifestSha256:digest(bytes)};
}

async function bounded(response,route,limit){
  requireOk(response.status===200 && !response.redirected,'Published resource not available/redirected: '+route);
  const mime=String(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(route.endsWith('.html'))requireOk(mime==='text/html','HTML MIME mismatch: '+route);
  if(route.endsWith('.css'))requireOk(mime==='text/css','CSS MIME mismatch: '+route);
  if(route.endsWith('.js')||route.endsWith('.mjs'))requireOk(mime.includes('javascript'),'JS MIME mismatch: '+route);
  const len=Number(response.headers?.get('content-length')||0);
  requireOk(Number.isSafeInteger(len)&&len>=0&&len<=limit,'Invalid published content length');
  requireOk(response.body,'Empty hosted response stream');
  const chunks=[];let total=0;
  for await(const part of response.body) {
    const buf=Buffer.from(part);
    total+=buf.length;
    requireOk(total<=limit,'Hosted asset exceeds size limit: '+route);
    chunks.push(buf);
  }
  requireOk(total>0,'Published asset is empty: '+route);
  return Buffer.concat(chunks);
}

export async function verifyPublicPages({trustedManifestBytes,sourceSha,fetchFn=globalThis.fetch}={}){
  requireOk(typeof sourceSha==='string' && SHA40.test(sourceSha),'Trusted exact main commit required');
  requireOk(typeof fetchFn==='function','HTTPS client missing');
  const trusted=verifyManifest(trustedManifestBytes);
  const base=PAGES_ORIGIN+PAGES_PREFIX;
  async function get(name,limit=MAX_ITEM){
    requireOk(name==='build-manifest.json'||VALID_PATH.test(name),'Invalid manifest path');
    const url=base+name+'?marcosa_release='+sourceSha;
    const response=await fetchFn(url,{method:'GET',cache:'no-store',redirect:'manual',
      credentials:'omit',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
    if(response.url){
      const got=new URL(response.url);
      requireOk(got.origin===PAGES_ORIGIN && got.pathname===PAGES_PREFIX+name &&
        got.searchParams.get('marcosa_release')===sourceSha,
        'Unexpected host/path or redirect for published asset');
    }
    return bounded(response,name,limit);
  }
  const remoteManifest=await get('build-manifest.json',2*1024*1024);
  requireOk(digest(remoteManifest)===trusted.sourceManifestSha256,
    'Public GitHub Pages manifest does not match SAME-RUN trusted build');
  const entries=Object.entries(trusted.assets);
  let offset=0,validated=0,totalBytes=0;
  const workers=Array.from({length:Math.min(4,entries.length)},async()=>{
    while(offset<entries.length){
      const index=offset++;
      const [name,expected]=entries[index];
      const bytes=await get(name);
      requireOk(digest(bytes)===expected,'Published bytes stale or mismatched: '+name);
      validated++;
      totalBytes+=bytes.length;
      requireOk(totalBytes<=MAX_TOTAL,'Hosted payload exceeds aggregate cap');
    }
  });
  await Promise.all(workers);
  requireOk(validated===entries.length,'Incomplete public Pages HTTP verification');
  return {verified:true,host:'osmanosmanov6880-bot.github.io',
    publicUrl:base,sourceSha,manifestSha256:trusted.sourceManifestSha256,
    assetsVerified:validated,totalBytes,productionAuthorized:false,
    caveat:'Public stateless Pages preview only, not marcosa.club or production Auth/Storage'};
}

function parseArgs(args){
  const a={};
  while(args.length){
    const key=args.shift(),value=args.shift();
    if(!['--manifest','--sha'].includes(key)||!value||Object.hasOwn(a,key)||value.startsWith('--'))
      throw Error('Usage: --manifest trusted-build-manifest.json --sha GITHUB_SHA');
    a[key]=value;
  }
  if(Object.keys(a).length!==2)throw Error('Manifest and exact source SHA required');
  return a;
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const bytes=readFileSync(args['--manifest']);
  let result,issue;
  for(let attempt=0;attempt<3;attempt++){
    try {result=await verifyPublicPages({trustedManifestBytes:bytes,sourceSha:args['--sha']});break;}
    catch(e){issue=e; if(attempt<2) await new Promise(r=>setTimeout(r,4500));}
  }
  if(!result)throw issue;
  console.log(JSON.stringify(result,null,2));
  console.log('PUBLIC_GITHUB_PAGES_BYTES_VERIFIED='+result.assetsVerified);
  console.log('PUBLIC_GITHUB_PAGES_READBACK=PASS');
  console.log('PRODUCTION_AUTHORIZED=NO');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(error){
    console.error(JSON.stringify({verified:false,productionAuthorized:false,error:String(error.message||error)}));
    process.exitCode=2;
  }
}
