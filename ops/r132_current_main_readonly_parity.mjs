#!/usr/bin/env node
/**
 * R132: fail-closed exact-current-main public SOURCE vs legacy live root.
 * Production access is read-only, manual, SSH-host-key pinned. This is NOT
 * authenticated behavior, database or built preview parity evidence.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FORMAT='MARCOSA-R132-CURRENT-MAIN-LEGACY-ROOT-SOURCE-READONLY-v1';
export const REPO='osmanosmanov6880-bot/marcosa-fusion';
export const COMPONENTS=Object.freeze([
  'marcosa-config.js','marcosa-supabase.js','interaction-bridge.js',
  'developer-console.js','nexus.js','supabase','scripts',
]);
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const FIELDS=new Set([
  'ROOT_PATH','ROOT_OWNER','DEPLOY_USER_CAN_WRITE_PRODUCTION',
  'LIVE_INDEX_SHA256','LIVE_INDEX_BYTES','LIVE_TOPLEVEL_SOURCE_COUNT',
  'PRODUCTION_COMPONENT_PRESENT','PRODUCTION_DISTINCT_COMPONENT_COUNT',
  'PRODUCTION_AUDIT_ONLY',
]);
const SINGLE=new Set([...FIELDS].filter(x=>x!=='PRODUCTION_COMPONENT_PRESENT'));
const must=(x,why)=>{if(!x)throw Error(why)};
const numeric=(v,min,max)=>/^(0|[1-9][0-9]*)$/.test(v||'')&&
  Number.isSafeInteger(Number(v))&&Number(v)>=min&&Number(v)<=max;
export function parseLegacyReadOnlyReport(input){
  must(typeof input==='string'&&input.length>50&&input.length<4096,
    'R132 bounded remote report missing');
  must(!/[\r\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input),
    'Control characters in legacy read-only report');
  const lines=input.trimEnd().split('\n');
  const fields=new Map();
  const components=[];
  for(const line of lines){
    const eq=line.indexOf('=');
    must(eq>0&&eq===line.lastIndexOf('='),
      'Invalid remote audit key/value line');
    const key=line.slice(0,eq),val=line.slice(eq+1);
    must(FIELDS.has(key)&&val.length>0&&val.length<=150,
      'Unknown or malformed remote audit field');
    if(key==='PRODUCTION_COMPONENT_PRESENT'){
      must(COMPONENTS.includes(val)&&!components.includes(val),
        'Unexpected or duplicated legacy component');
      components.push(val);
    }else{
      must(!fields.has(key),'Duplicate live audit field');
      fields.set(key,val);
    }
  }
  must([...SINGLE].every(k=>fields.has(k)), 'Incomplete remote audit report');
  must(fields.get('ROOT_PATH')==='/opt/marcosa/current'&&
    /^root:[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(fields.get('ROOT_OWNER')),
    'Legacy root path or ownership mismatched');
  must(fields.get('DEPLOY_USER_CAN_WRITE_PRODUCTION')==='NO'&&
    fields.get('PRODUCTION_AUDIT_ONLY')==='YES',
    'Production read-only boundary not proven');
  must(SHA64.test(fields.get('LIVE_INDEX_SHA256')),
    'Real live index SHA-256 missing');
  must(numeric(fields.get('LIVE_INDEX_BYTES'),1,10*1024*1024)&&
    numeric(fields.get('LIVE_TOPLEVEL_SOURCE_COUNT'),1,10000)&&
    numeric(fields.get('PRODUCTION_DISTINCT_COMPONENT_COUNT'),0,COMPONENTS.length),
    'Unsafe or incomplete live source counts');
  must(Number(fields.get('PRODUCTION_DISTINCT_COMPONENT_COUNT'))===components.length,
    'Reported legacy component count does not match actual output');
  return Object.freeze({
    liveIndexSha256:fields.get('LIVE_INDEX_SHA256'),
    liveIndexBytes:Number(fields.get('LIVE_INDEX_BYTES')),
    legacyRootOwnedByRoot:true,
    deploymentAccountCannotWriteProduction:true,
    topLevelFileCount:Number(fields.get('LIVE_TOPLEVEL_SOURCE_COUNT')),
    observedLegacyComponents:components.slice().sort(),
  });
}
export function auditCurrentSource({sourceSha,sourceIndexSha,sourceIndexBytes,remote}={}){
  must(SHA40.test(sourceSha||''),'Exact 40-character main SHA required');
  must(SHA64.test(sourceIndexSha||'')&&
    Number.isSafeInteger(sourceIndexBytes)&&
    sourceIndexBytes>0&&sourceIndexBytes<=10*1024*1024,
    'Bounded exact-source index SHA-256 and byte size required');
  const found=parseLegacyReadOnlyReport(remote);
  const equal=found.liveIndexSha256===sourceIndexSha&&
    found.liveIndexBytes===sourceIndexBytes;
  return Object.freeze({
    format:FORMAT,sourceSha,scope:'read_only_legacy_root_vs_exact_main_public_source',
    verifiedCheckoutMainSource:true,
    currentMainSourceIndexSha256:sourceIndexSha,
    currentMainSourceIndexBytes:sourceIndexBytes,
    liveLegacyIndexSha256:found.liveIndexSha256,
    liveLegacyIndexBytes:found.liveIndexBytes,
    indexBytesIdenticalWithCurrentSource:equal,
    legacyTopLevelFileCount:found.topLevelFileCount,
    observedLegacyComponents:found.observedLegacyComponents,
    missingCriticalLegacyComponents:[
      'marcosa-config.js','marcosa-supabase.js','interaction-bridge.js',
      'developer-console.js','nexus.js',
    ].filter(x=>!found.observedLegacyComponents.includes(x)),
    deployedPreviewArtifactIndependentlyAttested:false,
    authJwtCookiesAndApiRuntimeParityProven:false,
    privateStorageAndRealDatabaseRestored:false,
    lastApprovedProductionOriginUnchangedByAudit:true,
    liveCompatibilityProven:false,
    productionCutoverAuthorized:false,productionDecision:'NO_GO',
    note:'Compares exact current main SOURCE index bytes with read-only root-owned legacy index. Does not claim published preview, API, Auth, database or runtime parity.',
  });
}
async function main(){
  must(process.argv.length===2,'No R132 arbitrary command arguments');
  must(process.env.GITHUB_REPOSITORY===REPO&&
    process.env.GITHUB_REF==='refs/heads/main'&&
    process.env.GITHUB_EVENT_NAME==='workflow_dispatch',
    'R132 exact-main manual dispatch required');
  const bytes=readFileSync('site/index.html');
  const actual=createHash('sha256').update(bytes).digest('hex');
  must(actual===process.env.SOURCE_INDEX_SHA,
    'R132 source index hash differs from checked-out current main source');
  must(Number(process.env.SOURCE_INDEX_BYTES)===bytes.length,
    'R132 source index byte count changed');
  let remote='',count=0;
  for await(const c of process.stdin){
    count+=c.length;
    must(count<4096,'R132 remote report exceeded maximum size');
    remote+=c.toString('utf8');
  }
  const proof=auditCurrentSource({
    sourceSha:process.env.RELEASE_SHA,
    sourceIndexSha:actual,sourceIndexBytes:bytes.length,
    remote,
  });
  writeFileSync('marcosa-r132-current-sha-readonly.json',
    JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R132_CURRENT_MAIN_PUBLIC_SOURCE_READONLY_AUDIT=PASS');
  console.log('R132_INDEX_BYTES_MATCH_SOURCE='+
    (proof.indexBytesIdenticalWithCurrentSource?'YES':'NO'));
  console.log('R132_LEGACY_APP_AND_AUTH_PARITY=NOT_VERIFIED');
  console.log('R132_PRODUCTION_CUTOVER=NO_GO');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main()}catch(e){
    console.error('R132_PRODUCTION_READONLY_REFUSED='+
      String(e.message||e).slice(0,170));
    process.exitCode=2;
  }
}
