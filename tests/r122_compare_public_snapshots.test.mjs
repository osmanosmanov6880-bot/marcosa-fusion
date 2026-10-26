import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {comparePublicSnapshots,FORMAT}
  from '../ops/r122_compare_public_snapshots.mjs';

const sha='a'.repeat(40),after='b'.repeat(40);
function report(sourceSha=sha){
  const files=[
    {name:'index.html',bytes:9,sha256:'c'.repeat(64)},
    {name:'marcosa-config.js',bytes:11,sha256:'d'.repeat(64)},
    {name:'nexus.js',bytes:8,sha256:'e'.repeat(64)},
  ];
  return {
    format:'MARCOSA-R121-VERIFIED-PUBLIC-FILE-HASH-BASELINE-v1',
    sourceSha,status:'PASS',scope:'public_top_level_only',
    completeCurrentPublicHashInventory:true,
    historicalAllFilesUnchangedVerified:false,
    mainProductionRootCutoverAuthorized:false,
    customerStorageOrAuthInspected:false,
    nonRootReadOnly:true,noProductionChangesMade:true,verdict:'NO_GO',
    numberOfHashedPublicFiles:files.length,
    publicFileHashes:files,
    publicBytesHashed:files.reduce((s,v)=>s+v.bytes,0),
    currentProductionIndexSha256:files[0].sha256,
    sha256OfCanonicalPublicManifest:createHash('sha256')
      .update(JSON.stringify(files)).digest('hex'),
    visibleCriticalLegacyFiles:['marcosa-config.js','nexus.js'],
    maliciousExtraUserField:'DO_NOT_COPY_CUSTOMER_SECRET',
  };
}
function pair(){
  return {baseline:report(),current:report(after),
    baselineRunId:101,currentRunId:202,expectedMainSha:after};
}
function rewrite(x){
  x.sha256OfCanonicalPublicManifest=createHash('sha256')
    .update(JSON.stringify(x.publicFileHashes)).digest('hex');
  x.numberOfHashedPublicFiles=x.publicFileHashes.length;
  x.publicBytesHashed=x.publicFileHashes.reduce((sum,v)=>sum+v.bytes,0);
  x.currentProductionIndexSha256=x.publicFileHashes.find(v=>v.name==='index.html').sha256;
  x.visibleCriticalLegacyFiles=x.publicFileHashes.map(x=>x.name)
    .filter(x=>x==='marcosa-config.js'||x==='nexus.js');
  return x;
}
test('exact same public hashes in two independently verified runs returns PASS only for public assets',()=>{
  const result=comparePublicSnapshots(pair());
  assert.equal(result.format,FORMAT);
  assert.equal(result.status,'PASS');
  assert.equal(result.unchangedPublicBytesBetweenTheseTwoSnapshots,true);
  assert.deepEqual(result.differences,{added:[],removed:[],modified:[]});
  for(const key of ['privateDatabasesAuthAndStorageVerified',
    'productionCutoverAuthorized','productionChanged'])
    assert.equal(result[key],false);
  assert.equal(result.verdict,'NO_GO');
  assert.equal(JSON.stringify(result).includes('DO_NOT_COPY_CUSTOMER_SECRET'),false);
});
test('same sha but two independent real run IDs may detect manual public root drift',()=>{
  const x=pair();
  x.current.sourceSha=sha;x.expectedMainSha=sha;
  x.current.publicFileHashes[1].sha256='f'.repeat(64);
  rewrite(x.current);
  const result=comparePublicSnapshots(x);
  assert.equal(result.status,'DRIFT');
  assert.deepEqual(result.differences.modified,['marcosa-config.js']);
});
test('change in JS/CSS with an unchanged index is detected',()=>{
  const x=pair();
  x.current.publicFileHashes[2].sha256='f'.repeat(64);
  rewrite(x.current);
  const v=comparePublicSnapshots(x);
  assert.equal(v.status,'DRIFT');
  assert.deepEqual(v.differences.modified,['nexus.js']);
  assert.deepEqual(v.differences.added,[]);
  assert.deepEqual(v.differences.removed,[]);
});
test('missing public file and newly added public file are distinguished',()=>{
  const x=pair();
  x.current.publicFileHashes=x.current.publicFileHashes.filter(v=>v.name!=='nexus.js');
  x.current.publicFileHashes.push({name:'new-feature.js',bytes:15,sha256:'f'.repeat(64)});
  x.current.publicFileHashes.sort((a,b)=>a.name<b.name?-1:1);
  rewrite(x.current);
  const result=comparePublicSnapshots(x);
  assert.deepEqual(result.differences.removed,['nexus.js']);
  assert.deepEqual(result.differences.added,['new-feature.js']);
  assert.equal(result.status,'DRIFT');
});
test('cannot compare one artifact with itself or fake IDs',()=>{
  const same=pair();same.currentRunId=101;
  assert.throws(()=>comparePublicSnapshots(same),/Two separate/);
  const bad=pair();bad.baselineRunId=-1;
  assert.throws(()=>comparePublicSnapshots(bad),/Two separate/);
});
test('current R121 artifact must attest exact current main commit',()=>{
  const x=pair();x.expectedMainSha='f'.repeat(40);
  assert.throws(()=>comparePublicSnapshots(x),/stale/);
});
test('no historical comparison of pending/failed or production-authorizing artifacts',()=>{
  for(const property of ['status','verdict','scope']){
    const x=pair();x.baseline[property]='PASS_BUT_FAKE';
    assert.throws(()=>comparePublicSnapshots(x),/Reject untrusted/);
  }
  for(const property of ['mainProductionRootCutoverAuthorized',
    'customerStorageOrAuthInspected']){
    const x=pair();x.current[property]=true;
    assert.throws(()=>comparePublicSnapshots(x),/Reject untrusted/);
  }
});
test('public file list is bounded, canonical and unmodifiable',()=>{
  const x=pair();x.current.publicFileHashes[0].sha256='not-sha';
  assert.throws(()=>comparePublicSnapshots(x),/Invalid current/);
  const y=pair();y.current.sha256OfCanonicalPublicManifest='0'.repeat(64);
  assert.throws(()=>comparePublicSnapshots(y),/canonical digest/);
  const z=pair();z.current.publicFileHashes[0].name='../secret.js';
  assert.throws(()=>comparePublicSnapshots(z),/Invalid current/);
});
test('rejects unsorted or repeated public filenames',()=>{
  const x=pair();x.current.publicFileHashes.reverse();
  assert.throws(()=>comparePublicSnapshots(x),/Unsorted/);
  const y=pair();y.current.publicFileHashes[1].name='index.html';
  assert.throws(()=>comparePublicSnapshots(y),/Duplicated|Unsorted/);
});
test('sensitive non-public assets cannot enter the comparative baseline',()=>{
  for(const privateName of ['secrets.json','.env','session data.js','private/token.js']){
    const x=pair();x.current.publicFileHashes[0].name=privateName;
    assert.throws(()=>comparePublicSnapshots(x),/Invalid current/);
  }
});
test('offline comparator does not need VPS creds and requires positive real run provenance',()=>{
  const yaml=readFileSync(new URL(
    '../.github/workflows/marcosa-r122-public-hash-diff.yml',import.meta.url),'utf8');
  assert.match(yaml,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/ref: main/);
  assert.match(yaml,/gh run download/);
  assert.match(yaml,/actual-vps-public-hashes/);
  assert.match(yaml,/git rev-parse HEAD/);
  assert.match(yaml,/persist-credentials: false/);
  assert.doesNotMatch(yaml,/DEPLOY_SSH_KEY|MARCOSA_STAGING_HOST|sudo |rsync --delete|ssh -T|0\.0\.0\.0/);
});
