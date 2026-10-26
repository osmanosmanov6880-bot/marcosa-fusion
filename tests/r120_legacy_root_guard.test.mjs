import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {BASELINE,evaluateLegacyFingerprint,FORMAT} from '../ops/r120_legacy_root_guard.mjs';

const sha='f'.repeat(40);
function sample(){
  return {
    expectedSha:sha,
    evidence:{
      format:'MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1',
      sourceSha:sha,verifiedPreviewScope:'public_static_preview_only',
      preliminaryAudit:'PASS',productionDecision:'NO_GO',
      directRootReplacementAllowed:false,productionAuthorized:false,
      productionChanged:false,accountsMigratedOrVerified:false,
      databasesBackedUpAndRestored:false,
      checks:{
        r117TripleProof:'PASS',
        realProductionRootReadOnlyParity:'PASS',
        stageShaEqualsAuditedMain:true,
      },
      existingRoot:{
        indexSha256:BASELINE.productionIndexSha256,
        criticalPublicIntegrationNamesPresent:[...BASELINE.criticalPublicFiles],
        criticalPublicIntegrationNamesAbsentInPreview:[...BASELINE.criticalPublicFiles],
        counts:{
          legacyPublicTopLevel:34,stagingManifest:63,legacyOnlyTopLevel:33,
          previewOnlyTopLevel:62,
          missingLegacyLocalReferences:0,missingPreviewLocalReferences:0,
        },
        secretRemoteEnv:'MUST_NEVER_LEAK',
      },
      isolatedStage:{indexSha256:'e'.repeat(64)},
    },
  };
}
test('real R118 baseline permits limited fingerprint PASS but still production NO_GO',()=>{
  const v=evaluateLegacyFingerprint(sample());
  assert.equal(v.format,FORMAT);
  assert.equal(v.status,'PASS');
  assert.equal(v.changedFields.length,0);
  assert.equal(v.observedCriticalPublicFiles.length,5);
  for(const key of ['productionFullyByteVerified','productionAuthenticatedAppCompatibilityVerified',
    'databaseOrUserMigrationVerified','legacyPublicRootReplacementAllowed',
    'productionCutoverAuthorized','productionModified'])
    assert.equal(v[key],false,key+' must always stay false');
  assert.equal(v.verdict,'NO_GO');
  assert.equal(JSON.stringify(v).includes('MUST_NEVER_LEAK'),false);
});
test('mutated old homepage SHA is alerting DRIFT, never new production authorization',()=>{
  const x=sample();x.evidence.existingRoot.indexSha256='d'.repeat(64);
  const v=evaluateLegacyFingerprint(x);
  assert.equal(v.status,'DRIFT');
  assert.deepEqual(v.changedFields,['PRODUCTION_PUBLIC_INDEX_DIGEST_CHANGED']);
  assert.equal(v.productionCutoverAuthorized,false);
});
test('old root file-count drift is detected without false root hash alarm',()=>{
  const x=sample();x.evidence.existingRoot.counts.legacyPublicTopLevel=36;
  const v=evaluateLegacyFingerprint(x);
  assert.deepEqual(v.changedFields,['PRODUCTION_PUBLIC_TOP_LEVEL_COUNT_CHANGED']);
});
test('missing critical legacy script gives explicit named alert',()=>{
  const x=sample();
  x.evidence.existingRoot.criticalPublicIntegrationNamesPresent=
    x.evidence.existingRoot.criticalPublicIntegrationNamesPresent.filter(x=>x!=='nexus.js');
  x.evidence.existingRoot.criticalPublicIntegrationNamesAbsentInPreview=
    x.evidence.existingRoot.criticalPublicIntegrationNamesAbsentInPreview.filter(x=>x!=='nexus.js');
  const v=evaluateLegacyFingerprint(x);
  assert.equal(v.status,'DRIFT');
  assert.ok(v.changedFields.includes('CRITICAL_LEGACY_INTEGRATION_MISSING:nexus.js'));
});
test('static preview can add new public files without a FALSE legacy-root drift',()=>{
  const x=sample();
  x.evidence.existingRoot.counts.stagingManifest=88;
  x.evidence.existingRoot.counts.legacyOnlyTopLevel=20;
  x.evidence.existingRoot.criticalPublicIntegrationNamesAbsentInPreview=[];
  assert.equal(evaluateLegacyFingerprint(x).status,'PASS');
});
test('different main SHA makes a past artifact unusable',()=>{
  assert.throws(()=>evaluateLegacyFingerprint({...sample(),expectedSha:'e'.repeat(40)}),/Untrusted/);
});
test('wrong, short or malformed expected SHA refused',()=>{
  for(const invalid of ['',undefined,'ab'.repeat(19),'g'.repeat(40)])
    assert.throws(()=>evaluateLegacyFingerprint({...sample(),expectedSha:invalid}));
});
test('R118 must actually show completed read-only proof, not mocked PR test',()=>{
  for(const field of ['r117TripleProof','realProductionRootReadOnlyParity','stageShaEqualsAuditedMain']){
    const x=sample();x.evidence.checks[field]='PENDING';
    assert.throws(()=>evaluateLegacyFingerprint(x),/Untrusted/);
  }
  const y=sample();y.evidence.preliminaryAudit='PENDING';
  assert.throws(()=>evaluateLegacyFingerprint(y),/Untrusted/);
});
test('production-authorizing or production-mutating report is always refused',()=>{
  for(const key of ['productionAuthorized','directRootReplacementAllowed',
    'productionChanged','accountsMigratedOrVerified','databasesBackedUpAndRestored']){
    const x=sample();x.evidence[key]=true;
    assert.throws(()=>evaluateLegacyFingerprint(x),/Untrusted/);
  }
});
test('rejects forged public filenames, duplicates, missing counts and invalid SHA',()=>{
  const x=sample();x.evidence.existingRoot.criticalPublicIntegrationNamesPresent=['.env'];
  assert.throws(()=>evaluateLegacyFingerprint(x),/Unexpected/);
  const y=sample();y.evidence.existingRoot.criticalPublicIntegrationNamesPresent=['nexus.js','nexus.js'];
  assert.throws(()=>evaluateLegacyFingerprint(y),/Duplicate/);
  const z=sample();z.evidence.existingRoot.counts.legacyPublicTopLevel=-1;
  assert.throws(()=>evaluateLegacyFingerprint(z),/Invalid public asset count/);
  const w=sample();w.evidence.existingRoot.indexSha256='bogus';
  assert.throws(()=>evaluateLegacyFingerprint(w),/Missing production/);
});
test('refuse artifact with non-subset missing-from-preview list',()=>{
  const x=sample();
  x.evidence.existingRoot.criticalPublicIntegrationNamesPresent=['nexus.js'];
  assert.throws(()=>evaluateLegacyFingerprint(x),/Unexpected or inconsistent/);
});
test('CLI never trusts arbitrary evidence path or wrong repository',()=>{
  const env={...process.env,GITHUB_REPOSITORY:'osmanosmanov6880-bot/marcosa-fusion',RELEASE_SHA:sha};
  const cmd=spawnSync(process.execPath,['ops/r120_legacy_root_guard.mjs','/tmp/secret.json'],
    {encoding:'utf8',env,timeout:10000});
  assert.notEqual(cmd.status,0);
  assert.match(cmd.stderr,/R120_REFUSED=/);
  assert.doesNotMatch(cmd.stdout,/R120_LEGACY_PUBLIC_FINGERPRINT=PASS/);
  const wrong=spawnSync(process.execPath,['ops/r120_legacy_root_guard.mjs','r118-evidence/marcosa-r118-production-boundary.json'],
    {encoding:'utf8',env:{...env,GITHUB_REPOSITORY:'attacker/repo'},timeout:10000});
  assert.notEqual(wrong.status,0);
});
test('GitHub action stays read-only, exact main SHA and no remote credentials',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/marcosa-r120-legacy-root-guard.yml',import.meta.url),'utf8');
  assert.match(yaml,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.match(yaml,/github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(yaml,/github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(yaml,/git rev-parse HEAD/);
  assert.match(yaml,/gh run download/);
  assert.match(yaml,/persist-credentials: false/);
  assert.doesNotMatch(yaml,/DEPLOY_SSH_KEY|MARCOSA_STAGING_HOST|sudo |rsync --delete|nginx -s reload|curl .*marcosa\.club/);
});
