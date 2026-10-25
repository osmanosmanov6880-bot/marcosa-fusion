#!/usr/bin/env node
/**
 * MARCOSA R90: read back REAL hosted STAGING bytes, not SSH's current symlink.
 * Read-only, HTTPS-only, redirect-forbidden, no authentication or client secrets.
 * The origin and allowlisted host must come from independently reviewed
 * staging environment configuration, NOT an untrusted PR payload.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FORMAT,sha256} from './staging-release-attestation.mjs';
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const BLOCKED_ENDINGS=['.local','.internal','.localhost','.test','.invalid','.example','.onion'];
function demand(ok,message){if(!ok)throw Error(message);}
export function requireStagingOrigin(origin,expectedHost){
 demand(typeof origin==='string'&&typeof expectedHost==='string','Staging origin and independently configured host are required');
 let u;try{u=new URL(origin);}catch{throw Error('Invalid STAGING origin');}
 const host=u.hostname.toLowerCase();
 demand(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/',
  'Origin must be HTTPS host root without credentials, path, query or fragment');
 demand(!u.port&&host===expectedHost&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(host)&&
  host.includes('.')&&!BLOCKED_ENDINGS.some(end=>host.endsWith(end))&&
  !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)&&
  !host.startsWith('localhost.')&&!host.includes('..'),
  'Staging hostname differs from the approved public DNS host or is not a public domain');
 return u.origin;
}
async function boundedResponse(res,path,limit,mime){
 demand(res&&res.status===200&&!res.redirected,'Hosted file unavailable, redirected or not HTTP 200: '+path);
 const contentType=String(res.headers?.get('content-type')||'').toLowerCase().split(';')[0].trim();
 demand(mime.includes(contentType),'Hosted file has unsafe or wrong MIME type: '+path);
 const declared=Number(res.headers?.get('content-length')||0);
 demand(Number.isSafeInteger(declared)&&declared>=0&&declared<=limit,'Hosted file declares excessive size: '+path);
 demand(res.body,'Hosted file has no response body: '+path);
 const chunks=[];let bytes=0;
 for await(const part of res.body){
  const bin=Buffer.from(part);bytes+=bin.length;
  demand(bytes<=limit,'Hosted file exceeds size limit: '+path);
  chunks.push(bin);
 }
 demand(bytes>0,'Hosted file is empty: '+path);
 return Buffer.concat(chunks);
}
export async function verifyHostedStaging({origin,expectedHost,sourceSha,expectedManifestSha256,fetchFn=globalThis.fetch}={}){
 const base=requireStagingOrigin(origin,expectedHost);
 demand(typeof sourceSha==='string'&&HEX40.test(sourceSha),'Exact reviewed source SHA required');
 demand(typeof expectedManifestSha256==='string'&&HEX64.test(expectedManifestSha256),'Independent trusted build-manifest SHA256 required');
 demand(typeof fetchFn==='function','HTTPS transport missing');
 async function get(path,cap,mimes){
  const url=base+'/'+path+'?marcosa_release='+sourceSha;
  const response=await fetchFn(url,{method:'GET',redirect:'manual',
   credentials:'omit',cache:'no-store',
   headers:{Accept:mimes.join(', '),'Cache-Control':'no-cache','Pragma':'no-cache'}});
  if(response.url){
   const actual=new URL(response.url);
   demand(actual.origin===base&&actual.pathname==='/'+path&&
    actual.searchParams.get('marcosa_release')===sourceSha,
    'Unexpected redirect, origin or asset route: '+path);
  }
  return boundedResponse(response,path,cap,mimes);
 }
 const attBuf=await get('staging-release.json',8192,['application/json','text/json']);
 let att;try{att=JSON.parse(attBuf.toString('utf8'));}catch{throw Error('Malformed staging provenance JSON');}
 demand(att&&typeof att==='object'&&!Array.isArray(att)&&att.format===FORMAT&&
  att.sourceSha===sourceSha&&HEX64.test(att.buildManifestSha256||'')&&
  Number.isSafeInteger(att.assetsCount)&&att.assetsCount>=3&&att.assetsCount<=5000&&
  att.releaseKind==='public_static_preview_only'&&
  att.productionAuthorized===false&&att.generatedBy==='verified-gha-build-v1',
  'Source SHA, static release type or provenance does not match reviewed commit');
 demand(att.buildManifestSha256===expectedManifestSha256,'Hosted attestation does not match trusted build-manifest SHA256');
 const manifestBytes=await get('build-manifest.json',2097152,['application/json','text/json']);
 demand(sha256(manifestBytes)===expectedManifestSha256,
  'Hosted build-manifest bytes mismatch the source-attested digest');
 let manifest;try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{throw Error('Malformed build-manifest JSON');}
 demand(manifest?.release_kind==='public_static_preview_only'&&
  manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files)&&
  Object.keys(manifest.files).length===att.assetsCount,
  'Hosted build-manifest is incomplete or incompatible');
 const targets=[
  ['index.html',2097152,['text/html']],
  ['network.js',1048576,['text/javascript','application/javascript']],
  ['network.css',1048576,['text/css']]
 ];
 const matched=[];
 for(const [path,cap,mimes] of targets){
  const expected=manifest.files[path];
  demand(typeof expected==='string'&&HEX64.test(expected),'Missing digest for '+path);
  const bytes=await get(path,cap,mimes);
  demand(sha256(bytes)===expected,'Stale or corrupt hosted bytes: '+path);
  matched.push({file:path,sha256:expected,bytes:bytes.length});
 }
 return {verified:true,mode:'public HTTPS static STAGING readback only',
  approvedOrigin:base,reviewedSourceSha:sourceSha,
  matchingBuildManifest:true,reviewedBuildManifestSha256:expectedManifestSha256,filesMatched:matched,
  productionAuthorized:false,providerHostKeyVerified:false,
  caveat:'A matching public HTTPS response does not independently prove hosting ownership, private Auth/Storage, DNS control, user data safety or authorization to launch.'};
}
function parseArgs(argv){
 const a={};
 while(argv.length){
  const k=argv.shift(),v=argv.shift();
  demand(['--origin','--host','--sha','--manifest-sha256'].includes(k)&&v&&!v.startsWith('--')&&!Object.hasOwn(a,k),'Usage: --origin HTTPS_STAGING --host REVIEWED_HOST --sha EXACT40');
  a[k]=v;
 }
 demand(Object.keys(a).length===4,'Usage: --origin HTTPS_STAGING --host REVIEWED_HOST --sha EXACT40');
 return a;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=parseArgs(process.argv.slice(2));
  const result=await verifyHostedStaging({origin:args['--origin'],expectedHost:args['--host'],sourceSha:args['--sha'],expectedManifestSha256:args['--manifest-sha256']});
  console.log(JSON.stringify(result,null,2));
 }catch(error){
  console.error(JSON.stringify({verified:false,productionAuthorized:false,error:String(error.message||error)}));
  process.exitCode=2;
 }
}
