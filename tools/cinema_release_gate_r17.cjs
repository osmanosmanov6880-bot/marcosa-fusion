'use strict';
// R17: a deterministic, fail-closed gate for proposed playable cinema packages.
// This checker performs no deployment and never assumes source code means a live domain.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const RECORDS=Object.freeze([
 Object.freeze({slug:'internet-v-humanity',source:'osmanosmanov6880-bot/internet-v-humanity',commit:'4c492d30656d16a908f0dbd851a703f815b2d34e',relative:'site/film-internet-v-humanity.html',blob:'f18380a086f2196cf0faab1a9c6568ebef854e9e',required:['end_human','end_algorithm'],alreadyPublishedInPreview:true}),
 Object.freeze({slug:'protocol-zero',source:'osmanosmanov6880-bot/protocol-zero',commit:'0f1841c0e56e47f7413bea9948e66200409e7a7a',relative:'site/film-protocol-zero.html',required:['PROTOCOL ZERO'],alreadyPublishedInPreview:false}),
 Object.freeze({slug:'adverse-judge',source:'osmanosmanov6880-bot/adverse-judge',commit:'f48a00510984a3da2d5527cd01ef8a51f102881e',relative:'site/film-adverse-judge.html',required:['ADVERSE JUDGE'],alreadyPublishedInPreview:false})
]);
const sha1=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
function inspect(root=ROOT){
 return RECORDS.map(record=>{
  const full=path.join(root,record.relative);
  if(!fs.existsSync(full))return {...record,status:'source_only',gate:false,reason:'NO_LOCAL_REVIEWED_STANDALONE'};
  if(fs.lstatSync(full).isSymbolicLink())return {...record,status:'rejected',gate:false,reason:'SYMLINK'};
  const data=fs.readFileSync(full);
  if(data.length<1000||data.length>8*1024*1024)return {...record,status:'rejected',gate:false,reason:'SIZE_OUTSIDE_REVIEW'};
  const html=data.toString('utf8');
  if(!record.required.every(marker=>html.includes(marker)))return {...record,status:'rejected',gate:false,reason:'MISSING_STORY_MARKER'};
  if(record.blob&&sha1(data)!==record.blob)return {...record,status:'rejected',gate:false,reason:'SOURCE_HASH_CHANGED'};
  if(/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=\s*["']https?:/i.test(html))return {...record,status:'needs_review',gate:false,reason:'EXTERNAL_DEPENDENCIES'};
  return {...record,status:'candidate',gate:false,reason:'BROWSER_QA_AND_NETWORK_GATE_REQUIRED'};
 });
}
if(require.main===module){
 const result=inspect().map(({slug,source,commit,status,gate,reason})=>({slug,source,commit,status,gate,reason}));
 console.log(JSON.stringify({schema:'marcosa-cinema-release-gate/v1',release:'R17',records:result},null,2));
 if(result.some(x=>x.status==='rejected'))process.exitCode=1;
}
module.exports={RECORDS,inspect,sha1};
