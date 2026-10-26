import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCertificate, R116, verifyR116ProofPayload} from '../ops/release_certificate_r117.mjs';
import {PIPELINES} from '../ops/release_evidence_r114.mjs';

const sha = 'a'.repeat(40);
const replacement = 'b'.repeat(40);
function mkRun(name,id,event='push',patch={}) {
  return {id, name, event, head_branch:'main', head_sha:sha,
    status:'completed', conclusion:'success', ...patch};
}
function goodJobs(jobNames) {
  return jobNames.map((name,i)=>({
    id:5000+i,name,status:'completed',conclusion:'success',
  }));
}
function example() {
  const pages=mkRun(PIPELINES.pages.name,7101);
  const staging=mkRun(PIPELINES.staging.name,7102);
  const rollback=mkRun(R116.name,7103,'workflow_run');
  return {
    sourceSha:sha,mainSha:sha,runs:[pages,staging,rollback],
    jobsByRun:{
      [pages.id]:goodJobs(PIPELINES.pages.jobs),
      [staging.id]:goodJobs(PIPELINES.staging.jobs),
      [rollback.id]:goodJobs(R116.requiredJobs),
    },
    artifactsByRun:{[rollback.id]:[{
      id:887766, name:'marcosa-r116-actual-vps-rollback-proof',
      expired:false,size_in_bytes:412,workflow_run:{id:rollback.id},
    }]},
  };
}
test('three SAME SHA proofs with completed success jobs yield a scoped preview PASS',()=>{
  const c=evaluateCertificate(example());
  assert.equal(c.status,'PASS');
  assert.equal(c.evidence.publicPages.status,'PASS');
  assert.equal(c.evidence.restrictedContaboStaging.status,'PASS');
  assert.equal(c.evidence.verifiedVpsRollbackCandidate.status,'PASS');
  assert.equal(c.evidence.verifiedVpsRollbackCandidate.jobs['read-only-vps-proof'],'success');
  assert.equal(c.productionAuthorized,false);
  assert.equal(c.productionCutoverVerified,false);
  assert.equal(c.publicStagingHttpsVerified,false);
  assert.equal(c.databaseBackupOrRestoreVerified,false);
  assert.equal(c.privateAuthOrAccountMigrationVerified,false);
  assert.equal(c.scope,'public_static_preview_only');
});
test('R116 superseded green live job with NO real artifact must FAIL',()=>{
  const c=example();
  delete c.artifactsByRun['7103'];
  const r=evaluateCertificate(c);
  assert.equal(r.status,'FAIL');
  assert.equal(r.evidence.verifiedVpsRollbackCandidate.reason,
    'NO_VERIFIED_ACTUAL_VPS_R116_ARTIFACT');
});
test('R116 proof from unrelated run or expired artifact must never issue certificate',()=>{
  for(const artifactPatch of [
    {expired:true},{workflow_run:{id:99999}},{size_in_bytes:0},{id:0},
    {name:'fake-r116-rollback-proof'}]){
    const c=example();
    Object.assign(c.artifactsByRun['7103'][0],artifactPatch);
    assert.equal(evaluateCertificate(c).status,'FAIL');
  }
});
test('a genuine same-run actual VPS proof preserves PREVIEW-only NO_GO',()=>{
  const c=evaluateCertificate(example());
  assert.equal(c.evidence.verifiedVpsRollbackCandidate.actualVpsProofArtifactId,887766);
  assert.equal(c.status,'PASS');
  assert.equal(c.productionAuthorized,false);
});

test('green R116 push-only offline tests are NOT actual VPS proof',()=>{
  const c=example();
  c.runs[2].event='push';
  const result=evaluateCertificate(c);
  assert.equal(result.status,'PENDING');
  assert.equal(result.evidence.verifiedVpsRollbackCandidate.reason,'NO_SAME_SHA_LIVE_VPS_RUN');
});
test('R116 workflow_run success with skipped live proof is FAIL, never PASS',()=>{
  const c=example();
  c.jobsByRun['7103'][1].conclusion='skipped';
  const result=evaluateCertificate(c);
  assert.equal(result.status,'FAIL');
  assert.equal(result.evidence.verifiedVpsRollbackCandidate.reason,'PROOF_JOB_FAILED_OR_SKIPPED');
});
test('R116 workflow_run success missing the live proof job is PENDING',()=>{
  const c=example();
  c.jobsByRun['7103']=c.jobsByRun['7103'].slice(0,1);
  assert.equal(evaluateCertificate(c).status,'PENDING');
});
test('stale successful run cannot pass for the current SHA',()=>{
  const c=example(); c.mainSha=replacement;
  const r=evaluateCertificate(c);
  assert.equal(r.status,'SUPERSEDED');
  assert.equal(r.productionAuthorized,false);
});
test('a different source SHA on the VPS proof cannot be substituted',()=>{
  const c=example();
  c.runs[2].head_sha=replacement;
  assert.equal(evaluateCertificate(c).evidence.verifiedVpsRollbackCandidate.status,'PENDING');
});
test('PR-branch proof or a workflow_dispatch simulation must not count',()=>{
  const c=example(); c.runs[2].head_branch='feature/sneaky';
  assert.equal(evaluateCertificate(c).status,'PENDING');
  const other=example(); other.runs[2].event='workflow_dispatch';
  assert.equal(evaluateCertificate(other).status,'PENDING');
});
test('an R116 run which has not finished is not evidence',()=>{
  const c=example(); c.runs[2].status='in_progress'; c.runs[2].conclusion=null;
  const r=evaluateCertificate(c);
  assert.equal(r.status,'PENDING');
  assert.equal(r.evidence.verifiedVpsRollbackCandidate.reason,'LIVE_VPS_RUN_NOT_FINISHED');
});
test('failure of R116 actual run blocks issuance regardless of past successes',()=>{
  const c=example();
  c.runs.push(mkRun(R116.name,7999,'workflow_run',{conclusion:'failure'}));
  const r=evaluateCertificate(c);
  assert.equal(r.status,'FAIL');
  assert.equal(r.evidence.verifiedVpsRollbackCandidate.runId,7999);
});
test('R116 green with missing jobs in API does not magically become PASS',()=>{
  const c=example();delete c.jobsByRun['7103'];
  assert.equal(evaluateCertificate(c).evidence.verifiedVpsRollbackCandidate.reason,
    'LIVE_VPS_JOBS_NOT_AVAILABLE');
});
test('Pages publication without real public HTTPS byte check cannot certify',()=>{
  const c=example();
  c.jobsByRun['7101']=goodJobs(PIPELINES.pages.jobs)
    .filter(j=>j.name!=='verify-public-bytes');
  const r=evaluateCertificate(c);
  assert.equal(r.evidence.publicPages.status,'PENDING');
  assert.equal(r.status,'PENDING');
});
test('failed Pages readback explicitly blocks certificate',()=>{
  const c=example();
  c.jobsByRun['7101'].find(j=>j.name==='verify-public-bytes').conclusion='failure';
  assert.equal(evaluateCertificate(c).status,'FAIL');
});
test('restricted STAGING without full SSH asset delivery cannot certify',()=>{
  const c=example();
  c.jobsByRun['7102']=goodJobs(PIPELINES.staging.jobs)
    .filter(j=>j.name!=='deploy_ssh_filesystem');
  assert.equal(evaluateCertificate(c).status,'PENDING');
});
test('a skipped offline rollback rehearsal is unacceptable even if live job passed',()=>{
  const c=example();c.jobsByRun['7103'][0].conclusion='skipped';
  assert.equal(evaluateCertificate(c).status,'FAIL');
});
test('duplicated jobs select newest conclusion rather than hiding a failure',()=>{
  const c=example();
  c.jobsByRun['7103'].push({
    id:90001,name:'read-only-vps-proof',status:'completed',conclusion:'failure',
  });
  assert.equal(evaluateCertificate(c).status,'FAIL');
});
test('missing or malformed trust inputs rejected without claiming production',()=>{
  assert.throws(()=>evaluateCertificate({...example(),sourceSha:'r117'}));
  assert.throws(()=>evaluateCertificate({...example(),runs:Array(501).fill(null)}));
  assert.throws(()=>evaluateCertificate({...example(),jobsByRun:null}));
});

test('R117 real triple-proof certificate is manual-only on exact main; PR tests remain',async()=>{
  const {readFileSync}=await import('node:fs');
  const yaml=readFileSync(new URL('../.github/workflows/marcosa-r117-release-certificate.yml',import.meta.url),'utf8');
  const on=yaml.split('on:\n')[1].split('permissions:\n')[0];
  assert.doesNotMatch(on,/^  workflow_run:/m);
  assert.match(on,/^  workflow_dispatch:/m);
  assert.match(on,/^  pull_request:/m);
  assert.match(yaml,/github.event_name == 'workflow_dispatch'/);
  assert.match(yaml,/github.ref == 'refs\/heads\/main'/);
  assert.match(yaml,/persist-credentials: false/);
  assert.doesNotMatch(yaml,/permissions:\s*\n\s+contents: write/);
});

test('R117 validates actual downloaded R116 JSON, not only artifact metadata',()=>{
  const proof={
    format:'MARCOSA-R116-ACTUAL-NONROOT-VPS-ROLLBACK-PROOF-v1',
    sourceSha:sha,previousReleaseSha:'e'.repeat(40),
    rollbackCandidateAssetsVerified:63,
    actualReadOnlyVpsSshCheck:true,
    previousFilesAndManifestSha256Verified:true,
    productionChanged:false,productionAuthorized:false,status:'PASS',
    rawPrivateCredentials:'never propagate',
  };
  const checked=verifyR116ProofPayload(proof,{expectedSha:sha,runId:7103});
  assert.equal(checked.actualR116VpsArtifactContent,'PASS');
  assert.equal(checked.previousReleaseSha,'e'.repeat(40));
  assert.equal(checked.rollbackCandidateAssetsVerified,63);
  assert.equal(checked.productionAuthorized,false);
  assert.doesNotMatch(JSON.stringify(checked),/never propagate/);
});
test('R117 rejects mismatch SHA, false SSH, mutated production or forged artifact payload',()=>{
  const valid={
    format:'MARCOSA-R116-ACTUAL-NONROOT-VPS-ROLLBACK-PROOF-v1',
    sourceSha:sha,previousReleaseSha:'e'.repeat(40),
    rollbackCandidateAssetsVerified:63,
    actualReadOnlyVpsSshCheck:true,
    previousFilesAndManifestSha256Verified:true,
    productionChanged:false,productionAuthorized:false,status:'PASS',
  };
  for(const change of [
    {sourceSha:'b'.repeat(40)},
    {previousReleaseSha:'not-hex'},
    {rollbackCandidateAssetsVerified:0},
    {actualReadOnlyVpsSshCheck:false},
    {previousFilesAndManifestSha256Verified:false},
    {productionChanged:true},{productionAuthorized:true},
    {status:'SKIPPED'},{format:'FAKE-VPS-PROOF'},
  ])assert.throws(()=>verifyR116ProofPayload({...valid,...change},
    {expectedSha:sha,runId:7103}),/does not attest/);
  assert.throws(()=>verifyR116ProofPayload(valid,{expectedSha:sha,runId:0}),
    /Exact R116 proof/);
});
test('R117 verifies R116 download content before saving a PASS certificate',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../ops/release_certificate_r117.mjs',import.meta.url),'utf8');
  assert.match(source,/gh[\s\S]*?run[\s\S]*?download/);
  assert.match(source,/R117_R116_ACTUAL_VPS_PROOF_JSON=PASS/);
  assert.ok(source.indexOf('downloadAndVerifyR116Proof({')<
    source.indexOf("writeFileSync('marcosa-r117-release-certificate.json'"));
});
