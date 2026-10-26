import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyR118LiveEvidence} from '../ops/r123_upstream_live_gate.mjs';

const REPO='osmanosmanov6880-bot/marcosa-fusion';
const SHA='e'.repeat(40);
function verifiedR118({liveResult='success',runResult='success',currentSha=SHA}={}){
  return {
    repository:REPO,expectedSha:SHA,upstreamRunId:7262000,
    run:{id:7262000,name:'MARCOSA | R118 actual production compatibility audit (READ ONLY, NO CUTOVER)',
      head_sha:currentSha,head_branch:'main',head_repository:{full_name:REPO},
      event:'workflow_run',status:'completed',conclusion:runResult},
    jobs:{jobs:[
      {name:'offline-contract',status:'completed',conclusion:'success',head_sha:SHA},
      {name:'live-production-parity',status:'completed',conclusion:liveResult,head_sha:SHA},
    ]},
    artifacts:{artifacts:[{id:12345,name:'marcosa-r118-production-boundary-no-go',
      expired:false,size_in_bytes:1664,workflow_run:{id:7262000}}]},
    report:{
      format:'MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1',
      sourceSha:SHA,preliminaryAudit:'PASS',
      verifiedPreviewScope:'public_static_preview_only',
      productionDecision:'NO_GO',directRootReplacementAllowed:false,
      productionAuthorized:false,productionChanged:false,
      accountsMigratedOrVerified:false,databasesBackedUpAndRestored:false,
      checks:{r117TripleProof:'PASS',realProductionRootReadOnlyParity:'PASS',
        stageShaEqualsAuditedMain:true},
      existingRoot:{counts:{legacyPublicTopLevel:34},
        criticalPublicIntegrationNamesPresent:['nexus.js']},
    },
  };
}
const r120=readFileSync(new URL('../.github/workflows/marcosa-r120-legacy-root-guard.yml',import.meta.url),'utf8');
const r121=readFileSync(new URL('../.github/workflows/marcosa-r121-full-legacy-hash-inventory.yml',import.meta.url),'utf8');

// Under GitHub Actions concurrency, cancel-in-progress:false still permits
// replacing an older PENDING run with a newer PENDING run in the same group.
// Every genuine upstream event must use a different group, not merely a SHA.
for(const stage of ['116','117','118','119']){
  test('R'+stage+' has its own upstream run-id concurrency group (no pending-run eviction)',()=>{
    const yaml=readFileSync(new URL(
      '../.github/workflows/marcosa-r'+stage+
      ({'116':'-rollback-readiness','117':'-release-certificate',
        '118':'-production-boundary','119':'-vps-social-smoke'}[stage])+'.yml',
      import.meta.url),'utf8');
    assert.match(yaml,new RegExp(
      'group: marcosa-r'+stage+'-\\$\\{\\{ github\\.event\\.workflow_run\\.id \\|\\| github\\.run_id \\}\\}'));
    assert.match(yaml,/cancel-in-progress: false/);
    assert.doesNotMatch(yaml,/cancel-in-progress: true/);
  });
}

for(const [version,yaml] of [['R120',r120],['R121',r121]]){
  test(version+' requires unique upstream run ID: do not cancel a different actual real-R118 proof',()=>{
    assert.match(yaml,/group: marcosa-r12[01]-\$\{\{ github\.event\.workflow_run\.id \|\| github\.run_id \}\}/);
    assert.match(yaml,/cancel-in-progress: false/);
    assert.doesNotMatch(yaml,/cancel-in-progress: true/);
  });
  test(version+' includes source SHA, read-only R118 artifact and real live-job validation',()=>{
    assert.match(yaml,/github\.event\.workflow_run\.conclusion == 'success'/);
    assert.match(yaml,/github\.event\.workflow_run\.head_branch == 'main'/);
    assert.match(yaml,/git rev-parse HEAD/);
    assert.match(yaml,/R118_RUN_ID="\$UPSTREAM_RUN_ID"/);
    assert.match(yaml,/gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$R118_RUN_ID"/);
    assert.match(yaml,/gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$R118_RUN_ID\/jobs\?per_page=100"/);
    assert.match(yaml,/gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$R118_RUN_ID\/artifacts\?per_page=100"/);
    assert.match(yaml,/gh run download/);
    assert.match(yaml,/node ops\/r123_upstream_live_gate\.mjs/);
    assert.match(yaml,/node --test tests\/r123_upstream_live_gate\.test\.mjs/);
    assert.match(yaml,/node --test tests\/r124_r118_downstream_attestation\.test\.mjs/);
  });
}
test('R120 validates actual R118 BEFORE granting even limited public baseline PASS',()=>{
  assert.ok(r120.indexOf('node ops/r123_upstream_live_gate.mjs') <
    r120.indexOf('node ops/r120_legacy_root_guard.mjs r118-evidence/'));
  assert.match(r120,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.doesNotMatch(r120,/DEPLOY_SSH_KEY|MARCOSA_STAGING_HOST|ssh -T|sudo |rsync --delete/);
});
test('R121 validates actual R118 BEFORE any raw public bytes could be read via pinned SSH',()=>{
  assert.ok(r121.indexOf('node ops/r123_upstream_live_gate.mjs') <
    r121.indexOf('ssh -T -i "$TMP/key"'));
  assert.match(r121,/StrictHostKeyChecking=yes/);
  assert.match(r121,/DEPLOY_USER.*MARCOSA_STAGING_USER/);
  assert.match(r121,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.doesNotMatch(r121,/sudo |systemctl restart|rsync --delete/);
});
test('R118 workflow success with a skipped LIVE job refuses attestation',()=>{
  assert.throws(()=>verifyR118LiveEvidence(verifiedR118({liveResult:'skipped'})),/did NOT complete/);
});
test('stale commit on current main refuses attestation despite full upstream success',()=>{
  assert.throws(()=>verifyR118LiveEvidence(verifiedR118({currentSha:'a'.repeat(40)})),/Untrusted/);
});
test('real R118 job PASS but a cancelled or failed top-level workflow refuses attestation',()=>{
  for(const status of ['cancelled','failure']){
    assert.throws(()=>verifyR118LiveEvidence(verifiedR118({runResult:status})),/Untrusted/);
  }
});
test('actual R118 read-only full provenance permits only limited diagnostics, not production changes',()=>{
  const proof=verifyR118LiveEvidence(verifiedR118());
  assert.equal(proof.actualNonrootVpsParityJob,'PASS');
  assert.equal(proof.authorizedToSmokeDisposableLoopbackOnly,true);
  assert.equal(proof.productionCutoverAuthorized,false);
  assert.equal(proof.productionFilesChanged,false);
  assert.equal(proof.productionDatabasesAccessed,false);
});
