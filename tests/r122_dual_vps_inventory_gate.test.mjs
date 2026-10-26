import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluateDoubleProof,verifySnapshot,verifyR124Installed,REPO,R121_NAME,
  R121_ARTIFACT,R121_FORMAT} from '../ops/r122_dual_vps_inventory_gate.mjs';

const SHA='a'.repeat(40), DIG='b'.repeat(64), INDEX='c'.repeat(64), BASE='d'.repeat(64);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(id=81001){
  const files=[
    {name:'index.html',bytes:1234,sha256:INDEX},
    {name:'nexus.js',bytes:876,sha256:DIG},
  ];
  return {
    runId:id,
    run:{id,name:R121_NAME,head_sha:SHA,head_branch:'main',
      head_repository:{full_name:REPO},event:'workflow_run',
      status:'completed',conclusion:'success'},
    jobs:{total_count:2,jobs:[
      {id:id*10+1,name:'offline-contract',status:'completed',conclusion:'success'},
      {id:id*10+2,name:'actual-vps-public-hashes',status:'completed',conclusion:'success',head_sha:SHA},
    ]},
    artifacts:{total_count:1,artifacts:[{
      id:id*10+3,name:R121_ARTIFACT,expired:false,size_in_bytes:1234,
      workflow_run:{id},
    }]},
    report:{format:R121_FORMAT,sourceSha:SHA,status:'PASS',
      scope:'public_top_level_only',completeCurrentPublicHashInventory:true,
      verifiedR118UpstreamRunId:id*100,verifiedR118NonrootVpsAttestation:true,
      historicalAllFilesUnchangedVerified:false,
      mainProductionRootCutoverAuthorized:false,
      customerStorageOrAuthInspected:false,nonRootReadOnly:true,
      noProductionChangesMade:true,verdict:'NO_GO',driftReasons:[],
      publicFileHashes:files,numberOfHashedPublicFiles:files.length,
      publicBytesHashed:2110,sha256OfCanonicalPublicManifest:hash(files),
      currentProductionIndexSha256:INDEX,verifiedR118OldIndexSha256:BASE,
      visibleCriticalLegacyFiles:['nexus.js'],
    },
  };
}
function pair(){return {expectedSha:SHA,first:fixture(),second:fixture(81002)};}
const rejects=(name,change,re)=>test(name,()=>{
  const p=pair();change(p);
  assert.throws(()=>evaluateDoubleProof(p),re);
});

test('two different actual VPS jobs with exactly matching files pass but production stays NO_GO',()=>{
  const result=evaluateDoubleProof(pair());
  assert.equal(result.status,'PASS');
  assert.equal(result.independentlyCompletedVpsJobs,true);
  assert.equal(result.r118UpstreamEventIdentityIndependentlyProven,false);
  assert.deepEqual(result.verifiedR118ParentRunIds,[8100100,8100200]);
  assert.equal(result.historicalAllFilesAlwaysUnchangedProven,false);
  assert.equal(result.productionCutoverAuthorized,false);
  assert.deepEqual(result.runIds,[81001,81002]);
});
test('changed public JS digest reports DRIFT, never PASS',()=>{
  const p=pair();p.second.report.publicFileHashes[1].sha256='e'.repeat(64);
  p.second.report.sha256OfCanonicalPublicManifest=hash(p.second.report.publicFileHashes);
  const r=evaluateDoubleProof(p);assert.equal(r.status,'DRIFT');
  assert.deepEqual(r.modifiedPublicFileNames,['nexus.js']);
  assert.equal(r.productionDecision,'NO_GO');
});
test('added public file reports DRIFT',()=>{
  const p=pair();p.second.report.publicFileHashes.push({name:'style.css',bytes:1,sha256:DIG});
  p.second.report.publicFileHashes.sort((a,b)=>a.name.localeCompare(b.name));
  p.second.report.numberOfHashedPublicFiles=3;
  p.second.report.publicBytesHashed=2111;
  p.second.report.sha256OfCanonicalPublicManifest=hash(p.second.report.publicFileHashes);
  const r=evaluateDoubleProof(p);
  assert.equal(r.status,'DRIFT');assert.deepEqual(r.addedPublicFileNames,['style.css']);
});
test('changed R118 baseline fails closed with DRIFT',()=>{
  const p=pair();p.second.report.verifiedR118OldIndexSha256='e'.repeat(64);
  const r=evaluateDoubleProof(p);assert.equal(r.status,'DRIFT');
  assert.equal(r.indexOrHistoricalBaselineMismatch,true);
});
rejects('identical R121 run ID refused',p=>{p.second=structuredClone(p.first)},/DISTINCT/);
rejects('same R118 parent fails',p=>{
  p.second.report.verifiedR118UpstreamRunId=p.first.report.verifiedR118UpstreamRunId;
},/DISTINCT R118/);
rejects('missing attested parent fails',p=>{
  delete p.first.report.verifiedR118UpstreamRunId;
},/malformed/);
rejects('duplicated VPS job id refused',p=>{p.second.jobs.jobs[1].id=p.first.jobs.jobs[1].id},/DISTINCT/);
rejects('duplicated artifact id refused',p=>{p.second.artifacts.artifacts[0].id=p.first.artifacts.artifacts[0].id},/DISTINCT/);
rejects('offline-only success is never real VPS proof',p=>{p.second.jobs.jobs[1].conclusion='skipped'},/DID NOT pass/);
rejects('queued R121 is not a completed VPS proof',p=>{p.second.run.status='queued';p.second.run.conclusion=null},/completion state/);
rejects('cancelled R121 is not a completed VPS proof',p=>{p.second.run.conclusion='cancelled'},/completion state/);
rejects('wrong source SHA refused',p=>{p.second.report.sourceSha='1'.repeat(40)},/malformed/);
rejects('wrong branch refused',p=>{p.second.run.head_branch='feature'},/wrong branch/);
rejects('wrong repository refused',p=>{p.first.run.head_repository.full_name='attacker/repo'},/wrong branch/);
rejects('wrong event refused',p=>{p.first.run.event='pull_request'},/wrong branch/);
rejects('workflow success but skipped real job refused',p=>{p.first.jobs.jobs[1].status='completed';p.first.jobs.jobs[1].conclusion='skipped'},/DID NOT pass/);
rejects('missing live job refused',p=>{p.first.jobs.jobs=p.first.jobs.jobs.slice(0,1)},/Incomplete/);
rejects('expired artifact refused',p=>{p.second.artifacts.artifacts[0].expired=true},/artifact/);
rejects('artifact from unrelated run refused',p=>{p.first.artifacts.artifacts[0].workflow_run.id=55},/artifact/);
rejects('duplicate official artifact refused',p=>{p.first.artifacts.artifacts.push({...p.first.artifacts.artifacts[0],id:55});p.first.artifacts.total_count=2},/artifact/);
rejects('oversized R121 artifact refused',p=>{p.first.artifacts.artifacts[0].size_in_bytes=131072},/artifact/);
rejects('incomplete GitHub pagination refused',p=>{p.second.jobs.total_count=101},/Incomplete/);
rejects('drifted R121 report cannot become stable R122 PASS',p=>{p.second.report.status='DRIFT'},/malformed/);
rejects('R121 public inventory count must match contents',p=>{p.first.report.numberOfHashedPublicFiles=3},/inconsistent/);
rejects('R121 public inventory byte totals must match',p=>{p.first.report.publicBytesHashed=2111},/inconsistent/);
rejects('R121 SHA-256 manifest must match actual records',p=>{p.first.report.publicFileHashes[1].sha256='e'.repeat(64)},/inconsistent/);
rejects('R121 index digest must match public index record',p=>{p.first.report.currentProductionIndexSha256=DIG},/index digest/);
rejects('R121 critical integration list must be honest',p=>{p.first.report.visibleCriticalLegacyFiles=[]},/critical legacy/);
rejects('private .env names cannot enter public proof',p=>{p.first.report.publicFileHashes[0].name='.env.json'},/secret-looking/);
rejects('path traversal cannot enter public proof',p=>{p.first.report.publicFileHashes[1].name='../nexus.js'},/secret-looking/);
rejects('unsorted public records refused',p=>{p.first.report.publicFileHashes.reverse()},/duplicate or unsorted/);
rejects('duplicate public records refused',p=>{p.first.report.publicFileHashes[1].name='index.html'},/duplicate or unsorted/);
rejects('production permission flag refused',p=>{p.first.report.mainProductionRootCutoverAuthorized=true},/malformed/);
rejects('customer storage inspection flag refused',p=>{p.first.report.customerStorageOrAuthInspected=true},/malformed/);
rejects('different actual job SHA refused',p=>{p.first.jobs.jobs[1].head_sha='c'.repeat(40)},/DID NOT pass/);

test('R124 installed contract accepts fixed anti-false-PASS guard markers',()=>{
  const r116='R116_PREVIOUS_RUN_SUPERSEDED=BLOCKED marcosa-r116-actual-vps-rollback-proof';
  const r117='marcosa-r116-actual-vps-rollback-proof NO_VERIFIED_ACTUAL_VPS_R116_ARTIFACT';
  const r121='node ops/r123_upstream_live_gate.mjs\nR118_RUN_ID: ${{ github.event.workflow_run.id }}\ngh api "repos/$GITHUB_REPOSITORY/actions/runs/$R118_RUN_ID/jobs?per_page=100"\nssh -T -i "$TMP/key"';
  assert.equal(verifyR124Installed({r116,r117,r121}),true);
  assert.throws(()=>verifyR124Installed({r116:'R116_PREVIOUS_RUN_SUPERSEDED=SKIP',r117,r121}),/R116/);
  assert.throws(()=>verifyR124Installed({r116,r117:'no gate',r121}),/R117/);
  assert.throws(()=>verifyR124Installed({r116,r117,r121:'ssh -T -i "$TMP/key"\nnode ops/r123_upstream_live_gate.mjs'}),/R121/);
});
