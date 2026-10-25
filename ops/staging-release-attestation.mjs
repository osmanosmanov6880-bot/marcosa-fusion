#!/usr/bin/env node
/**
 * R90: content-addressed PUBLIC STATIC staging proof.
 * Not a signature or an approval to deploy. Never reads secrets or credentials.
 * The readback verifier independently fetches the published files over HTTPS.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const FORMAT='MARCOSA-STAGING-READBACK-v1';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
export const sha256=raw=>createHash('sha256').update(raw).digest('hex');

export function makeStagingAttestation({sourceSha,manifestBytes}={}){
 if(typeof sourceSha!=='string'||!SHA.test(sourceSha))throw Error('Exact 40-character lowercase reviewed commit SHA required');
 if(!Buffer.isBuffer(manifestBytes)||manifestBytes.length<20||manifestBytes.length>2097152)
  throw Error('Valid bounded build-manifest bytes required');
 let manifest;try{manifest=JSON.parse(manifestBytes.toString('utf8'));}
 catch{throw Error('Build manifest is not valid JSON');}
 if(manifest?.release_kind!=='public_static_preview_only'||!manifest.files||
    typeof manifest.files!=='object'||Array.isArray(manifest.files))throw Error('Only audited static preview manifest is supported');
 const entries=Object.entries(manifest.files);
 if(entries.length<3||entries.length>5000||!['index.html','network.js','network.css'].every(key=>DIGEST.test(manifest.files[key]||'')))
  throw Error('Baseline static site files and digests required');
 for(const [name,digest] of entries){
  if(typeof name!=='string'||name.length<1||name.length>180||name.startsWith('.')||
     name.includes('..')||name.includes('\\')||name.startsWith('/')||!DIGEST.test(digest))
   throw Error('Unsafe file or digest in build manifest');
 }
 return Object.freeze({format:FORMAT,sourceSha,buildManifestSha256:sha256(manifestBytes),
  assetsCount:entries.length,releaseKind:'public_static_preview_only',
  productionAuthorized:false,generatedBy:'verified-gha-build-v1'});
}
function main(){
 const args=process.argv.slice(2),options={};
 while(args.length){
  const key=args.shift(),value=args.shift();
  if(!['--sha','--manifest','--output'].includes(key)||key in options||typeof value!=='string'||!value||value.startsWith('--'))
   throw Error('Usage: --sha GIT_COMMIT --manifest BUILD_MANIFEST --output NEW_STAGING_JSON');
  options[key]=value;
 }
 if(Object.keys(options).length!==3)throw Error('Required: --sha --manifest --output');
 const proof=makeStagingAttestation({sourceSha:options['--sha'],
  manifestBytes:readFileSync(resolve(options['--manifest']))});
 writeFileSync(resolve(options['--output']),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o644});
 console.log(JSON.stringify({created:true,sourceSha:proof.sourceSha,productionAuthorized:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error('R90 STAGING BUNDLE BLOCKED: '+error.message);process.exitCode=2;}
}
