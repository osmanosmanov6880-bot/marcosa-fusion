#!/usr/bin/env node
/**
 * MARCOSA R122: compare two independent R121 read-only VPS public file
 * snapshots for one exact current main SHA. Never a production cutover gate.
 * Inputs are fixed, bounded GitHub API files and two downloaded artifacts.
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO = 'osmanosmanov6880-bot/marcosa-fusion';
export const R121_NAME = 'MARCOSA | R121 complete legacy PUBLIC file hashes (READ ONLY, NO CUTOVER)';
export const R121_ARTIFACT = 'marcosa-r121-legacy-public-hashes';
export const R121_FORMAT = 'MARCOSA-R121-VERIFIED-PUBLIC-FILE-HASH-BASELINE-v1';
export const FORMAT = 'MARCOSA-R122-DOUBLE-INDEPENDENT-REAL-VPS-PUBLIC-PROOF-v1';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SUFFIXES = new Set(['html','htm','css','js','mjs','svg','webp','png','jpg','jpeg','json']);
const BLOCKED = new Set(['config.json','secrets.json','settings.json','credentials.json']);
const CRITICAL = ['developer-console.js','interaction-bridge.js','marcosa-config.js',
  'marcosa-supabase.js','nexus.js'];
const requireThat = (ok, reason) => {if(!ok) throw new Error(reason)};
const positive = n => Number.isSafeInteger(n) && n > 0;
const uint = (n,max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const filenameSafe = s => typeof s==='string' && FILE.test(s) &&
  !s.toLowerCase().includes('.env') && !BLOCKED.has(s.toLowerCase()) &&
  SUFFIXES.has(s.split('.').at(-1).toLowerCase());

/** This guard prevents R122 from treating pre-R124, unprotected R121 jobs as proof. */
export function verifyR124Installed({r116,r117,r121}={}) {
  requireThat(typeof r116==='string' &&
    r116.includes('R116_PREVIOUS_RUN_SUPERSEDED=BLOCKED') &&
    r116.includes('marcosa-r116-actual-vps-rollback-proof') &&
    !r116.includes('R116_PREVIOUS_RUN_SUPERSEDED=SKIP'),
    'R124 R116 fail-closed actual VPS artifact gate not installed on main');
  requireThat(typeof r117==='string' &&
    r117.includes('marcosa-r116-actual-vps-rollback-proof') &&
    r117.includes('NO_VERIFIED_ACTUAL_VPS_R116_ARTIFACT'),
    'R124 R117 actual R116 artifact requirement not installed on main');
  requireThat(typeof r121==='string' &&
    r121.includes('node ops/r123_upstream_live_gate.mjs') &&
    r121.includes('R118_RUN_ID: ${{ github.event.workflow_run.id }}') &&
    r121.includes('gh api "repos/$GITHUB_REPOSITORY/actions/runs/$R118_RUN_ID/jobs?per_page=100"') &&
    r121.indexOf('node ops/r123_upstream_live_gate.mjs') < r121.indexOf('ssh -T -i "$TMP/key"'),
    'R124 R121 real R118 live job proof must run before SSH on main');
  return true;
}

export function verifySnapshot({runId,run,jobs,artifacts,report,expectedSha}={}) {
  requireThat(HEX40.test(expectedSha||''), 'Exact main source SHA is required');
  requireThat(positive(runId), 'Valid R121 workflow run ID required');
  requireThat(run && run.id===runId && run.name===R121_NAME &&
    run.head_sha===expectedSha && run.head_branch==='main' &&
    run.head_repository?.full_name===REPO && run.event==='workflow_run' &&
    run.status==='completed' && run.conclusion==='success',
    'R121 run is wrong branch, source SHA, repository, event or completion state');
  requireThat(jobs && Array.isArray(jobs.jobs) && jobs.jobs.length>=2 &&
    jobs.jobs.length<=100 &&
    (jobs.total_count===undefined || jobs.total_count===jobs.jobs.length),
    'Incomplete R121 actual job list');
  const jobFor = name => jobs.jobs.filter(j => j?.name===name);
  const offline = jobFor('offline-contract');
  const live = jobFor('actual-vps-public-hashes');
  requireThat(offline.length===1 && live.length===1 &&
    offline[0].status==='completed' && offline[0].conclusion==='success' &&
    live[0].status==='completed' && live[0].conclusion==='success' &&
    positive(live[0].id) && positive(offline[0].id) && live[0].id!==offline[0].id &&
    (!live[0].head_sha || live[0].head_sha===expectedSha),
    'Real R121 VPS public hashing job DID NOT pass');
  requireThat(artifacts && Array.isArray(artifacts.artifacts) &&
    artifacts.artifacts.length<=100 &&
    (artifacts.total_count===undefined || artifacts.total_count===artifacts.artifacts.length),
    'Incomplete R121 artifacts metadata');
  const matching = artifacts.artifacts.filter(a=>a?.name===R121_ARTIFACT);
  requireThat(matching.length===1 && positive(matching[0].id) &&
    matching[0].expired===false && uint(matching[0].size_in_bytes,65536) &&
    matching[0].size_in_bytes>=100 &&
    (!matching[0].workflow_run || matching[0].workflow_run.id===runId),
    'Missing, wrong-run, duplicated or expired real R121 artifact');
  requireThat(report && typeof report==='object' && !Array.isArray(report) &&
    report.format===R121_FORMAT && report.sourceSha===expectedSha &&
    report.status==='PASS' && report.scope==='public_top_level_only' &&
    report.completeCurrentPublicHashInventory===true &&
    report.historicalAllFilesUnchangedVerified===false &&
    report.mainProductionRootCutoverAuthorized===false &&
    report.customerStorageOrAuthInspected===false &&
    report.nonRootReadOnly===true && report.noProductionChangesMade===true &&
    report.verdict==='NO_GO' &&
    positive(report.verifiedR118UpstreamRunId) &&
    report.verifiedR118NonrootVpsAttestation===true &&
    Array.isArray(report.driftReasons) && report.driftReasons.length===0,
    'R121 report malformed, drifted, outdated or unsafe');
  const files=report.publicFileHashes;
  requireThat(Array.isArray(files) && files.length>=1 && files.length<=128,
    'R121 public file inventory missing or out of bounds');
  const safeFiles=files.map(f=>{
    requireThat(f && typeof f==='object' && !Array.isArray(f) &&
      filenameSafe(f.name) && uint(f.bytes,32*1024*1024) && HEX64.test(f.sha256||''),
      'Malformed or secret-looking public filename/digest record');
    return {name:f.name,bytes:f.bytes,sha256:f.sha256};
  });
  const ordered=[...safeFiles].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  requireThat(safeFiles.every((f,i)=>f.name===ordered[i].name) &&
    new Set(safeFiles.map(f=>f.name)).size===safeFiles.length,
    'R121 public file inventory duplicate or unsorted');
  const sum=safeFiles.reduce((n,f)=>n+f.bytes,0);
  requireThat(uint(sum,268435456) && report.publicBytesHashed===sum &&
    report.numberOfHashedPublicFiles===safeFiles.length &&
    jsonHash(safeFiles)===report.sha256OfCanonicalPublicManifest,
    'R121 public file counts, bytes or canonical SHA-256 inconsistent');
  const index=safeFiles.find(f=>f.name==='index.html');
  requireThat(index && report.currentProductionIndexSha256===index.sha256 &&
    HEX64.test(report.verifiedR118OldIndexSha256||''),
    'R121 production index digest or R118 baseline missing');
  const critical=CRITICAL.filter(name=>safeFiles.some(f=>f.name===name));
  requireThat(Array.isArray(report.visibleCriticalLegacyFiles) &&
    JSON.stringify([...report.visibleCriticalLegacyFiles].sort())===
    JSON.stringify([...critical].sort()),
    'R121 critical legacy filenames inconsistent');
  return Object.freeze({
    runId,r118RunId:report.verifiedR118UpstreamRunId,
    actualVpsJobId:live[0].id,artifactId:matching[0].id,
    canonicalManifestSha256:report.sha256OfCanonicalPublicManifest,
    indexSha256:index.sha256,baselineIndexSha256:report.verifiedR118OldIndexSha256,
    files:safeFiles,totalBytes:sum,
  });
}

export function evaluateDoubleProof({expectedSha,first,second}={}) {
  requireThat(HEX40.test(expectedSha||''),'Exact full current main SHA required');
  const a=verifySnapshot({...first,expectedSha});
  const b=verifySnapshot({...second,expectedSha});
  requireThat(a.runId!==b.runId && a.actualVpsJobId!==b.actualVpsJobId &&
    a.artifactId!==b.artifactId,
    'Two DISTINCT R121 run IDs, VPS jobs and artifacts are mandatory');
  requireThat(a.r118RunId!==b.r118RunId,'Two DISTINCT R118 parent runs mandatory');
  const mapA=new Map(a.files.map(f=>[f.name,f]));
  const mapB=new Map(b.files.map(f=>[f.name,f]));
  const added=b.files.filter(f=>!mapA.has(f.name)).map(f=>f.name);
  const removed=a.files.filter(f=>!mapB.has(f.name)).map(f=>f.name);
  const changed=a.files.filter(f=>mapB.has(f.name) &&
    (mapB.get(f.name).sha256!==f.sha256 || mapB.get(f.name).bytes!==f.bytes))
    .map(f=>f.name);
  const indexMismatch=a.indexSha256!==b.indexSha256 ||
    a.baselineIndexSha256!==b.baselineIndexSha256;
  const stable=!indexMismatch && !added.length && !removed.length &&
    !changed.length && a.canonicalManifestSha256===b.canonicalManifestSha256;
  return Object.freeze({
    format:FORMAT,sourceSha:expectedSha,
    status:stable?'PASS':'DRIFT',
    scope:'same_sha_two_separate_read_only_public_top_level_vps_snapshots',
    independentlyCompletedVpsJobs:true,
    r118UpstreamEventIdentityIndependentlyProven:false,
    r118ParentRunIdsDistinctAndAttestedByR121:true,
    historicalAllFilesAlwaysUnchangedProven:false,
    customerAuthOrPrivateStorageInspected:false,
    productionCutoverAuthorized:false,
    productionFilesChanged:false,
    productionDecision:'NO_GO',
    runIds:[a.runId,b.runId],verifiedR118ParentRunIds:[a.r118RunId,b.r118RunId],
    vpsJobIds:[a.actualVpsJobId,b.actualVpsJobId],
    artifactIds:[a.artifactId,b.artifactId],
    firstManifestSha256:a.canonicalManifestSha256,
    secondManifestSha256:b.canonicalManifestSha256,
    publicFilesFirst:a.files.length,publicFilesSecond:b.files.length,
    modifiedPublicFileNames:changed,addedPublicFileNames:added,
    removedPublicFileNames:removed,indexOrHistoricalBaselineMismatch:indexMismatch,
    note:'Two independent real VPS SHA-256 snapshots at the same current main SHA; no private data, authenticated behavior or release permission. R118 exact upstream event linkage not independently certified by this R122 report.',
  });
}

function readJsonFixed(filename,max){
  const bytes=readFileSync(filename);
  requireThat(bytes.length>=2 && bytes.length<=max,'Missing or oversized JSON evidence');
  return JSON.parse(bytes.toString('utf8'));
}
function main(){
  requireThat(process.env.GITHUB_REPOSITORY===REPO,'Wrong repository');
  requireThat(process.argv.length===2,'Only fixed local GitHub evidence filenames accepted');
  const idA=Number(process.env.R121_RUN_A),idB=Number(process.env.R121_RUN_B);
  requireThat(positive(idA) && positive(idB) && idA!==idB,
    'Two distinct numeric R121 run IDs are required');
  verifyR124Installed({
    r116:readFileSync('.github/workflows/marcosa-r116-rollback-readiness.yml','utf8'),
    r117:readFileSync('ops/release_certificate_r117.mjs','utf8'),
    r121:readFileSync('.github/workflows/marcosa-r121-full-legacy-hash-inventory.yml','utf8'),
  });
  const make=(suffix,runId)=>({runId,
    run:readJsonFixed('r122-'+suffix+'-run.json',65536),
    jobs:readJsonFixed('r122-'+suffix+'-jobs.json',65536),
    artifacts:readJsonFixed('r122-'+suffix+'-artifacts.json',65536),
    report:readJsonFixed('r122-'+suffix+'-report.json',65536),
  });
  const report=evaluateDoubleProof({expectedSha:process.env.RELEASE_SHA,
    first:make('a',idA),second:make('b',idB)});
  writeFileSync('marcosa-r122-double-real-vps-acceptance.json',
    JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R122_TWO_ACTUAL_VPS_PUBLIC_HASH_SNAPSHOTS='+report.status);
  console.log('R122_FIRST_RUN_ID='+idA);
  console.log('R122_SECOND_RUN_ID='+idB);
  console.log('R122_PRODUCTION_CUTOVER=NO_GO');
  if(process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      '### MARCOSA R122: two distinct real VPS public hash snapshots',
      '- Same exact main SHA: '+report.sourceSha,
      '- First R121 VPS run: '+idA,
      '- Second R121 VPS run: '+idB,
      '- Byte-for-byte current public inventory: **'+report.status+'**',
      '- Independent source R118 event linkage: NOT PROVEN by R122 itself',
      '- Production cutover: **NO_GO**',
      '',
    ].join('\n'));
  if(report.status!=='PASS')process.exitCode=3;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(err){
    console.error('R122_PROOF_REFUSED='+String(err.message||err).slice(0,180));
    process.exitCode=2;
  }
}
