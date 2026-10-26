import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const r48=readFileSync(new URL(
  '../.github/workflows/marcosa-r48-release-gate.yml',import.meta.url),'utf8');
const r133=readFileSync(new URL(
  '../.github/workflows/marcosa-r133-automatic-proof.yml',import.meta.url),'utf8');
const source=readFileSync(new URL(
  '../ops/r133_one_sha_automatic_evidence_gate.mjs',import.meta.url),'utf8');
const triggers=r48.slice(r48.indexOf('on:\n')+4,r48.indexOf('permissions:\n'));
const pr=triggers.split('  pull_request:\n')[1].split('  push:\n')[0];
const push=triggers.split('  push:\n')[1].split('  workflow_dispatch:\n')[0];

test('R135 produces actual R48 push proof for EVERY main commit, not just ops changes',()=>{
  assert.match(push,/^    branches: \[main\]$/m);
  assert.doesNotMatch(push,/^\s+paths:$/m);
  assert.doesNotMatch(push,/ops\/\*\*|marcosa-r48-release-gate\.yml/);
});
test('R135 PR checks remain scoped to relevant security sources and tests',()=>{
  assert.match(pr,/^    branches: \[main\]$/m);
  assert.match(pr,/^    paths:$/m);
  assert.match(pr,/"ops\/\*\*"/);
  assert.match(pr,/"tests\/r135_main_sha_r48_contract\.test\.mjs"/);
});
test('R135 existing R133 strict gate actually requires a same-SHA push R48 proof',()=>{
  assert.match(source,/r48:Object\.freeze\(\{/);
  assert.match(source,/file:'marcosa-r48-release-gate\.yml'/);
  assert.match(source,/jobs:\['contract-tests'\],event:'push'/);
  assert.match(source,/sourceSha===currentMainSha/);
  assert.match(source,/run\.head_sha===sourceSha/);
});
test('R135 R48 is read-only, cannot deploy, and never grants automatic GO',()=>{
  assert.match(r48,/^permissions:\n  contents: read$/m);
  assert.match(r48,/Prove placeholder evidence cannot signal production readiness/);
  assert.match(r48,/"productionAuthorized": false/);
  assert.doesNotMatch(r48,/\brsync\b|\bscp\b|\bssh\b\s+"|DEPLOY_SSH_KEY|service_role|secrets\./);
});
test('R135 retains deliberate manual workflow_dispatch with explicit profile',()=>{
  assert.match(triggers,/^  workflow_dispatch:$/m);
  assert.match(r48,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(r48,/--profile "\$\{\{ inputs\.profile \}\}"/);
  assert.doesNotMatch(r48,/^\s{2}workflow_run:/m);
});
test('R135 new proof-source contract tests are exercised by real R48 CI',()=>{
  assert.match(r48,/node --test ops\/test\/release-gate\.test\.mjs tests\/r135_main_sha_r48_contract\.test\.mjs/);
});
test('R135 does not weaken actual R133 manual-only external verification',()=>{
  assert.match(r133,/github\.event_name == 'workflow_dispatch'/);
  assert.match(r133,/github\.ref == 'refs\/heads\/main'/);
  assert.match(source,/requiredManualEvidenceNotProven/);
  assert.match(source,/productionCutoverAuthorized:false/);
  assert.match(source,/productionDecision:'NO_GO'/);
});
