#!/usr/bin/env node
/**
 * R121: sanitize and cross-check the real VPS public-file digest inventory
 * against the exact-current-main R118 read-only report.
 * This establishes a NEW whole-public-top-level baseline, NOT retroactive
 * proof every file stayed unchanged since R118.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FORMAT='MARCOSA-R121-VERIFIED-PUBLIC-FILE-HASH-BASELINE-v1';
export const OLD_INDEX='33d79f35b6d4873113cab99575606e5700802c0d0720eefd4604d49fe08aa9b3';
export const CRITICAL=Object.freeze([
  'developer-console.js','interaction-bridge.js','marcosa-config.js',
  'marcosa-supabase.js','nexus.js',
]);
const SOURCE='MARCOSA-R121-LEGACY-PUBLIC-FILE-INVENTORY-v1';
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const FILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SUFFIXES=new Set(['html','htm','css','js','mjs','svg','webp','png','jpg','jpeg','json']);
const SENSITIVE=new Set(['config.json','secrets.json','settings.json','credentials.json']);
const demand=(x,m)=>{if(!x)throw Error(m);};
function safeName(s){
  return typeof s==='string'&&FILE.test(s)&&!s.toLowerCase().includes('.env')&&
    !SENSITIVE.has(s.toLowerCase())&&SUFFIXES.has(s.split('.').at(-1).toLowerCase());
}
function boundedNumber(n,max=268435456){
  return Number.isSafeInteger(n)&&n>=0&&n<=max;
}
function safeJson(filename,maximum){
  const raw=readFileSync(filename);
  demand(raw.length>=5&&raw.length<=maximum,'Unsafe or oversized JSON evidence');
  return JSON.parse(raw.toString('utf8'));
}

export function evaluatePublicInventory({expectedSha,r118,inventory}={}){
  demand(SHA40.test(expectedSha||''),'Exact full current main SHA required');
  demand(r118&&typeof r118==='object'&&!Array.isArray(r118)&&
    r118.format==='MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1'&&
    r118.sourceSha===expectedSha&&
    r118.preliminaryAudit==='PASS'&&
    r118.productionDecision==='NO_GO'&&
    r118.productionAuthorized===false&&
    r118.productionChanged===false&&
    r118.directRootReplacementAllowed===false&&
    r118.verifiedPreviewScope==='public_static_preview_only'&&
    r118.checks?.r117TripleProof==='PASS'&&
    r118.checks?.realProductionRootReadOnlyParity==='PASS'&&
    r118.checks?.stageShaEqualsAuditedMain===true,
    'R118 provenance missing/stale/not read-only');
  demand(inventory&&typeof inventory==='object'&&!Array.isArray(inventory)&&
    inventory.format===SOURCE&&inventory.readOnly===true&&
    inventory.productionAuthorized===false&&
    inventory.publicTopLevelOnly===true,
    'Untrusted read-only public hash collector');
  demand(Array.isArray(inventory.files)&&inventory.files.length>=1&&inventory.files.length<=128,
    'Invalid bounded public file list');
  demand(boundedNumber(inventory.totalBytes)&&
    boundedNumber(inventory.fileCount,128)&&inventory.fileCount===inventory.files.length,
    'Invalid reported public asset counts');
  const normalized=inventory.files.map(f=>{
    demand(f&&typeof f==='object'&&safeName(f.name)&&
      SHA64.test(f.sha256||'')&&boundedNumber(f.bytes,32*1024*1024),
      'Rejected invalid public asset record');
    return {name:f.name,bytes:f.bytes,sha256:f.sha256};
  });
  const ordered=[...normalized].sort((a,b)=>a.name.localeCompare(b.name,'en'));
  demand(JSON.stringify(ordered.map(f=>f.name))===
    JSON.stringify(normalized.map(f=>f.name)),'Public files are not deterministically sorted');
  demand(new Set(normalized.map(f=>f.name)).size===normalized.length,
    'Duplicate public basename');
  demand(normalized.reduce((sum,f)=>sum+f.bytes,0)===inventory.totalBytes,
    'Public byte totals do not match');
  const index=normalized.find(f=>f.name==='index.html');
  demand(index&&index.sha256===inventory.indexSha256,
    'Missing or forged public index SHA');
  const declared=inventory.criticalPresent;
  demand(Array.isArray(declared)&&declared.length<=CRITICAL.length&&
    declared.every(x=>typeof x==='string'&&CRITICAL.includes(x))&&
    new Set(declared).size===declared.length,'Unsafe critical public filename list');
  const observed=CRITICAL.filter(x=>normalized.some(f=>f.name===x));
  demand(JSON.stringify([...declared].sort())===JSON.stringify([...observed].sort()),
    'Inconsistent critical public-file inventory');
  const knownCount=r118.existingRoot?.counts?.legacyPublicTopLevel;
  const knownIndex=r118.existingRoot?.indexSha256;
  const required=r118.existingRoot?.criticalPublicIntegrationNamesPresent;
  demand(boundedNumber(knownCount,128)&&SHA64.test(knownIndex||'')&&
    Array.isArray(required)&&required.length<=CRITICAL.length&&
    required.every(x=>CRITICAL.includes(x)), 'Incomplete trusted R118 public baseline');
  const reasons=[];
  if(knownCount!==normalized.length)reasons.push('COUNT_CHANGED_SINCE_R118');
  if(knownIndex!==index.sha256)reasons.push('INDEX_CHANGED_SINCE_R118');
  if(index.sha256!==OLD_INDEX)reasons.push('INDEX_CHANGED_SINCE_PINNED_R118_BASELINE');
  for(const name of required){
    if(!observed.includes(name))reasons.push('MISSING_CRITICAL_FILE:'+name);
  }
  const manifestSha256=createHash('sha256')
    .update(JSON.stringify(normalized)).digest('hex');
  return {
    format:FORMAT,
    sourceSha:expectedSha,
    status:reasons.length?'DRIFT':'PASS',
    note:'Full SHA256 snapshot of presently PUBLIC top-level files. No prior per-file hashes exist to prove historical byte-for-byte unchanged state.',
    scope:'public_top_level_only',
    completeCurrentPublicHashInventory:true,
    historicalAllFilesUnchangedVerified:false,
    mainProductionRootCutoverAuthorized:false,
    customerStorageOrAuthInspected:false,
    nonRootReadOnly:true,
    noProductionChangesMade:true,
    numberOfHashedPublicFiles:normalized.length,
    publicBytesHashed:inventory.totalBytes,
    sha256OfCanonicalPublicManifest:manifestSha256,
    currentProductionIndexSha256:index.sha256,
    verifiedR118OldIndexSha256:knownIndex,
    visibleCriticalLegacyFiles:observed,
    driftReasons:reasons,
    publicFileHashes:normalized,
    verdict:'NO_GO',
  };
}
function main(){
  demand(process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion',
    'Wrong GitHub repository');
  demand(process.argv.length===2,'No arbitrary input filenames accepted');
  const sha=process.env.RELEASE_SHA;
  const report=evaluatePublicInventory({
    expectedSha:sha,
    r118:safeJson('r118-evidence/marcosa-r118-production-boundary.json',65536),
    inventory:safeJson('r121-remote-public-inventory.json',65536),
  });
  writeFileSync('marcosa-r121-public-file-hashes.json',
    JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R121_CURRENT_FULL_PUBLIC_HASH_INVENTORY='+report.status);
  console.log('R121_PUBLIC_FILES_HASHED='+report.numberOfHashedPublicFiles);
  console.log('R121_NO_PRODUCTION_CUTOVER=TRUE');
  console.log('R121_ACTUAL_MAIN_SHA='+report.sourceSha);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
    '### MARCOSA R121 — every eligible legacy public asset hashed',
    '- Exact source commit: '+report.sourceSha,
    '- Complete public top-level inventory: '+report.status,
    '- Public files hashed: '+report.numberOfHashedPublicFiles,
    '- Canonical public manifest SHA-256: '+report.sha256OfCanonicalPublicManifest,
    '- Historical per-file preservation: NOT PROVEN (new baseline only)',
    '- Production switch and private customer data: NOT TOUCHED / NO_GO',
    '',
  ].join('\n'));
  if(report.status!=='PASS')process.exitCode=3;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(e){
    console.error('R121_PUBLIC_HASH_PROOF_REFUSED='+String(e.message||e).slice(0,160));
    process.exitCode=2;
  }
}
