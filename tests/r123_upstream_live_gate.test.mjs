import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {verifyR118LiveEvidence} from '../ops/r123_upstream_live_gate.mjs';

const SHA='a'.repeat(40);
const NAME='MARCOSA | R118 actual production compatibility audit (READ ONLY, NO CUTOVER)';
const REPO='osmanosmanov6880-bot/marcosa-fusion';
function fixture(){
  return {
    repository:REPO,expectedSha:SHA,upstreamRunId:500001,
    run:{
      id:500001,name:NAME,head_sha:SHA,head_branch:'main',
      head_repository:{full_name:REPO},event:'workflow_run',
      status:'completed',conclusion:'success',
    },
    jobs:{jobs:[
      {name:'offline-contract',status:'completed',conclusion:'success',head_sha:SHA},
      {name:'live-production-parity',status:'completed',conclusion:'success',head_sha:SHA},
    ]},
    artifacts:{artifacts:[{
      id:80001,name:'marcosa-r118-production-boundary-no-go',expired:false,
      size_in_bytes:2147,workflow_run:{id:500001},
    }]},
    report:{
      format:'MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1',
      sourceSha:SHA,preliminaryAudit:'PASS',
      verifiedPreviewScope:'public_static_preview_only',
      productionDecision:'NO_GO',directRootReplacementAllowed:false,
      productionAuthorized:false,productionChanged:false,
      accountsMigratedOrVerified:false,databasesBackedUpAndRestored:false,
      checks:{
        r117TripleProof:'PASS',realProductionRootReadOnlyParity:'PASS',
        stageShaEqualsAuditedMain:true,
      },
      existingRoot:{
        counts:{legacyPublicTopLevel:34},
        criticalPublicIntegrationNamesPresent:[
          'marcosa-config.js','marcosa-supabase.js',
          'interaction-bridge.js','developer-console.js','nexus.js',
        ],
        privateToken:'NEVER_LEAK_RAW_PRIVATE_DATA',
      },
      customerInfo:'NEVER_LEAK_PRIVATE_CUSTOMERS',
    },
  };
}
test('only a completed, real R118 nonroot VPS job and NO_GO artifact authorize disposable R119 smoke',()=>{
  const proof=verifyR118LiveEvidence(fixture());
  assert.equal(proof.actualNonrootVpsParityJob,'PASS');
  assert.equal(proof.boundedR118NoGoArtifact,'PASS');
  assert.equal(proof.sourceSha,SHA);
  assert.equal(proof.criticalPublicModulesPresent,5);
  assert.equal(proof.authorizedToSmokeDisposableLoopbackOnly,true);
  assert.equal(proof.productionCutoverAuthorized,false);
  assert.equal(proof.productionFilesChanged,false);
  assert.equal(proof.productionDatabasesAccessed,false);
  assert.doesNotMatch(JSON.stringify(proof),/NEVER_LEAK_/);
});
test('workflow-level success with skipped real VPS R118 job is NEVER accepted',()=>{
  for(const state of ['skipped','cancelled','failure',null]){
    const x=fixture();x.jobs.jobs[1].conclusion=state;
    assert.throws(()=>verifyR118LiveEvidence(x),/real read-only VPS job/);
  }
});
test('R118 offline PASS only, live job missing, is not a real upstream proof',()=>{
  const x=fixture();x.jobs.jobs.pop();
  assert.throws(()=>verifyR118LiveEvidence(x),/Incomplete R118 job list/);
});
test('R118 run must be completed SUCCESS, never queued/cancelled/failed',()=>{
  for(const status of ['queued','pending','in_progress']){
    const x=fixture();x.run.status=status;
    assert.throws(()=>verifyR118LiveEvidence(x),/Untrusted/);
  }
  for(const conclusion of ['cancelled','failure','skipped']){
    const x=fixture();x.run.conclusion=conclusion;
    assert.throws(()=>verifyR118LiveEvidence(x),/Untrusted/);
  }
});
test('current commit and exact upstream run id must match GitHub API',()=>{
  const x=fixture();x.expectedSha='b'.repeat(40);
  assert.throws(()=>verifyR118LiveEvidence(x),/Untrusted/);
  const y=fixture();y.upstreamRunId=6;
  assert.throws(()=>verifyR118LiveEvidence(y),/Untrusted/);
  const z=fixture();z.jobs.jobs[1].head_sha='b'.repeat(40);
  assert.throws(()=>verifyR118LiveEvidence(z),/real read-only/);
});
test('wrong repo, pull request branch, fork, manually bypassed R118 refused',()=>{
  const x=fixture();x.repository='attacker/repo';
  assert.throws(()=>verifyR118LiveEvidence(x),/Wrong repository/);
  const y=fixture();y.run.head_repository.full_name='attacker/repo';
  assert.throws(()=>verifyR118LiveEvidence(y),/Untrusted/);
  const z=fixture();z.run.head_branch='pr-136';
  assert.throws(()=>verifyR118LiveEvidence(z),/Untrusted/);
  const w=fixture();w.run.event='workflow_dispatch';
  assert.throws(()=>verifyR118LiveEvidence(w),/Untrusted/);
});
test('wrong upstream workflow name, duplicated job and wrong job status refused',()=>{
  const x=fixture();x.run.name='unrelated';
  assert.throws(()=>verifyR118LiveEvidence(x),/Untrusted/);
  const y=fixture();y.jobs.jobs.push({...y.jobs.jobs[1]});
  assert.throws(()=>verifyR118LiveEvidence(y),/real read-only/);
  const z=fixture();z.jobs.jobs[0].status='in_progress';
  assert.throws(()=>verifyR118LiveEvidence(z),/real read-only/);
});
test('artifact must exist, be non-expired, and belong to that exact run',()=>{
  const x=fixture();x.artifacts.artifacts=[];
  assert.throws(()=>verifyR118LiveEvidence(x),/Missing live R118/);
  const y=fixture();y.artifacts.artifacts[0].expired=true;
  assert.throws(()=>verifyR118LiveEvidence(y),/Missing live R118/);
  const z=fixture();z.artifacts.artifacts[0].workflow_run.id=5;
  assert.throws(()=>verifyR118LiveEvidence(z),/Missing live R118/);
});
test('NO_GO report must prove true read-only R118 and never allow mutation',()=>{
  for(const key of ['productionAuthorized','productionChanged',
    'directRootReplacementAllowed','accountsMigratedOrVerified',
    'databasesBackedUpAndRestored']){
    const x=fixture();x.report[key]=true;
    assert.throws(()=>verifyR118LiveEvidence(x),/artifact/);
  }
  const y=fixture();y.report.checks.realProductionRootReadOnlyParity='SKIPPED';
  assert.throws(()=>verifyR118LiveEvidence(y),/artifact/);
});
test('wrong JSON shape or malformed legacy counts are rejected',()=>{
  const x=fixture();x.report.existingRoot.counts.legacyPublicTopLevel=-1;
  assert.throws(()=>verifyR118LiveEvidence(x),/malformed/);
  const y=fixture();y.report.existingRoot.criticalPublicIntegrationNamesPresent=['token'.repeat(40)];
  assert.throws(()=>verifyR118LiveEvidence(y),/malformed/);
  const z=fixture();z.jobs={};
  assert.throws(()=>verifyR118LiveEvidence(z),/Incomplete/);
});
test('R119 implementation requires actual upstream GitHub evidence even on manual dispatch',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/marcosa-r119-vps-social-smoke.yml',import.meta.url),'utf8');
  assert.match(yaml,/verified_r118_run_id:/);
  assert.match(yaml,/R118_RUN_ID:/);
  assert.match(yaml,/gh api/);
  assert.match(yaml,/gh run download/);
  assert.match(yaml,/node ops\/r123_upstream_live_gate\.mjs/);
  assert.match(yaml,/R123_REAL_R118_NONROOT_VPS_UPSTREAM=PASS/);
  assert.match(yaml,/concurrency:[\s\S]*cancel-in-progress: false/);
  assert.match(yaml,/server-lab\/media\/safe-png\.mjs/);
  assert.match(yaml,/server-lab\/ops\/moderation-queue-health\.mjs/);
  assert.doesNotMatch(yaml,/tar -czf - server-lab\s/);
  assert.doesNotMatch(yaml,/sudo |systemctl restart|rsync --delete|nginx -s reload/);
});
test('R118 live audit must not be cancelled by a second same-SHA workflow event',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/marcosa-r118-production-boundary.yml',import.meta.url),'utf8');
  assert.match(yaml,/concurrency:[\s\S]*cancel-in-progress: false/);
  assert.match(yaml,/StrictHostKeyChecking=yes/);
  assert.match(yaml,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
});
test('CLI refuses missing approved evidence, never emits a fake PASS',()=>{
  const p=spawnSync(process.execPath,['ops/r123_upstream_live_gate.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:12000,
    env:{...process.env,GITHUB_REPOSITORY:REPO,RELEASE_SHA:SHA,R118_RUN_ID:'500001'},
  });
  assert.notEqual(p.status,0);
  assert.match(p.stderr,/R123_UPSTREAM_REFUSED=/);
  assert.doesNotMatch(p.stdout,/=PASS/);
});
