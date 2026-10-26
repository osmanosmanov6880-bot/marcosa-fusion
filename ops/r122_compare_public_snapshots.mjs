#!/usr/bin/env node
/**
 * MARCOSA R122 — compare two independently attested R121 public file inventories.
 * No HTTP, SSH, DNS, SQL, production writes or customer data. GitHub workflow
 * checks the provenance of both runs before downloading their public hashes.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FORMAT='MARCOSA-R122-TWO-ATTESTED-PUBLIC-SNAPSHOTS-v1';
const INPUT='MARCOSA-R121-VERIFIED-PUBLIC-FILE-HASH-BASELINE-v1';
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ALLOWED=new Set(['html','htm','css','js','mjs','svg','webp','png','jpg','jpeg','json']);
const HIDDEN=new Set(['config.json','settings.json','secrets.json','credentials.json']);
const demand=(ok,message)=>{if(!ok)throw Error(message);};
const goodRun=n=>Number.isSafeInteger(n)&&n>0;
const fileName=x=>typeof x==='string'&&NAME.test(x)&&
  !x.toLowerCase().includes('.env')&&!HIDDEN.has(x.toLowerCase())&&
  ALLOWED.has(x.split('.').at(-1).toLowerCase());
function inputReport(report,kind){
  demand(report&&typeof report==='object'&&!Array.isArray(report)&&
    report.format===INPUT&&report.status==='PASS'&&
    SHA40.test(report.sourceSha||'')&&
    report.scope==='public_top_level_only'&&
    report.completeCurrentPublicHashInventory===true&&
    report.historicalAllFilesUnchangedVerified===false&&
    report.mainProductionRootCutoverAuthorized===false&&
    report.customerStorageOrAuthInspected===false&&
    report.nonRootReadOnly===true&&
    report.noProductionChangesMade===true&&
    report.verdict==='NO_GO',
    'Reject untrusted '+kind+' public snapshot');
  const raw=report.publicFileHashes;
  demand(Array.isArray(raw)&&raw.length>=1&&raw.length<=128 &&
    report.numberOfHashedPublicFiles===raw.length,
    'Missing or inconsistent '+kind+' public entries');
  const items=raw.map(v=>{
    demand(v&&typeof v==='object'&&fileName(v.name)&&
      Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=32*1024*1024&&
      SHA64.test(v.sha256||''),'Invalid '+kind+' public file entry');
    return {name:v.name,bytes:v.bytes,sha256:v.sha256};
  });
  const sorted=[...items].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  demand(JSON.stringify(sorted)===JSON.stringify(items),'Unsorted '+kind+' file list');
  demand(new Set(items.map(v=>v.name)).size===items.length,
    'Duplicated '+kind+' filenames');
  const index=items.find(v=>v.name==='index.html');
  demand(index&&index.sha256===report.currentProductionIndexSha256,
    'Missing or forged '+kind+' public index');
  const total=items.reduce((sum,v)=>sum+v.bytes,0);
  demand(total===report.publicBytesHashed&&total<=256*1024*1024,
    'Invalid '+kind+' public byte totals');
  const hash=createHash('sha256').update(JSON.stringify(items)).digest('hex');
  demand(hash===report.sha256OfCanonicalPublicManifest,
    'Broken '+kind+' signed-by-evidence canonical digest');
  const present=items.map(v=>v.name);
  demand(Array.isArray(report.visibleCriticalLegacyFiles)&&
    report.visibleCriticalLegacyFiles.every(name=>present.includes(name))&&
    new Set(report.visibleCriticalLegacyFiles).size===
      report.visibleCriticalLegacyFiles.length,
    'Contradictory '+kind+' critical file list');
  return {sourceSha:report.sourceSha,entries:items,hash};
}

export function comparePublicSnapshots({
  baseline,current,baselineRunId,currentRunId,expectedMainSha,
}={}){
  demand(goodRun(baselineRunId)&&goodRun(currentRunId)&&
    baselineRunId!==currentRunId,
    'Two separate actual GitHub Actions run IDs required');
  demand(SHA40.test(expectedMainSha||''),'Exact current main SHA required');
  const a=inputReport(baseline,'baseline');
  const b=inputReport(current,'current');
  demand(b.sourceSha===expectedMainSha,
    'Current snapshot is stale relative to main');
  const previous=new Map(a.entries.map(v=>[v.name,v]));
  const latest=new Map(b.entries.map(v=>[v.name,v]));
  const added=[...latest.keys()].filter(name=>!previous.has(name)).sort();
  const removed=[...previous.keys()].filter(name=>!latest.has(name)).sort();
  const modified=[...latest.keys()].filter(name=>{
    const old=previous.get(name),now=latest.get(name);
    return old&&(old.sha256!==now.sha256||old.bytes!==now.bytes);
  }).sort();
  const status=added.length||removed.length||modified.length?'DRIFT':'PASS';
  return {
    format:FORMAT,
    status,
    scope:'two_independent_public_top_level_R121_hash_snapshots_only',
    baseline:{runId:baselineRunId,sourceSha:a.sourceSha,
      manifestSha256:a.hash,fileCount:a.entries.length},
    current:{runId:currentRunId,sourceSha:b.sourceSha,
      manifestSha256:b.hash,fileCount:b.entries.length},
    differences:{added,removed,modified},
    unchangedPublicBytesBetweenTheseTwoSnapshots:status==='PASS',
    privateDatabasesAuthAndStorageVerified:false,
    productionCutoverAuthorized:false,
    productionChanged:false,
    verdict:'NO_GO',
    note:'PASS indicates identical PUBLIC-file hashes in these two attested R121 snapshots; DRIFT indicates reported differences. Neither result attests prior years, customer databases, Auth, billing or application compatibility.',
  };
}
function readJson(path){
  const bytes=readFileSync(path);
  demand(bytes.length>=10&&bytes.length<=65536,'Missing or oversized snapshot');
  return JSON.parse(bytes.toString('utf8'));
}
function main(){
  demand(process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion',
    'Repository mismatch');
  demand(process.argv.length===2,'Only fixed vetted snapshot paths are accepted');
  const result=comparePublicSnapshots({
    baseline:readJson('r122-baseline/marcosa-r121-public-file-hashes.json'),
    current:readJson('r122-current/marcosa-r121-public-file-hashes.json'),
    baselineRunId:Number(process.env.BASELINE_RUN_ID),
    currentRunId:Number(process.env.CURRENT_RUN_ID),
    expectedMainSha:process.env.CURRENT_MAIN_SHA,
  });
  writeFileSync('marcosa-r122-legacy-public-diff.json',
    JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R122_LEGACY_PUBLIC_TWO_SNAPSHOT_VERDICT='+result.status);
  console.log('R122_CHANGED_FILES='+result.differences.modified.length);
  console.log('R122_ADDED_FILES='+result.differences.added.length);
  console.log('R122_REMOVED_FILES='+result.differences.removed.length);
  console.log('R122_PRODUCTION_CUTOVER_AUTHORIZED=NO');
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
    '### R122 — independent same-root PUBLIC SHA-256 snapshot comparison',
    '- Baseline GitHub Actions run: '+result.baseline.runId,
    '- Current GitHub Actions run: '+result.current.runId,
    '- Public legacy file bytes match: '+result.status,
    '- Added / removed / modified: '+
      [result.differences.added.length,result.differences.removed.length,
        result.differences.modified.length].join(' / '),
    '- Database/Auth/private Storage and production cutover remain NO_GO.',
    '',
  ].join('\n'));
  if(result.status!=='PASS')process.exitCode=3;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(e){console.error('R122_COMPARISON_BLOCKED='+String(e.message||e).slice(0,160));process.exitCode=2;}
}
