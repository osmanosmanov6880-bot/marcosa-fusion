import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(
  new URL('../.github/workflows/marcosa-r133-automatic-proof.yml',import.meta.url),'utf8');
const source=readFileSync(
  new URL('../ops/r133_one_sha_automatic_evidence_gate.mjs',import.meta.url),'utf8');

test('R134 unique GitHub Actions concurrency per run, not a literal unexpanded string',()=>{
  assert.match(workflow,/^  group: marcosa-r133-\$\{\{ github\.run_id \}\}$/m);
  assert.match(workflow,/^  cancel-in-progress: false$/m);
});
test('R134 read-only GitHub API credential is the supported Actions token expression',()=>{
  assert.match(workflow,/^          GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(workflow,/^permissions:\n  contents: read\n  actions: read$/m);
  assert.doesNotMatch(workflow,/GH_TOKEN:.*secrets\./);
});
test('R134 contains no malformed single-brace GitHub expression',()=>{
  assert.doesNotMatch(workflow,/\$\{(?!\{)/);
  const starts=(workflow.match(/\$\{\{/g)||[]).length;
  const ends=(workflow.match(/\}\}/g)||[]).length;
  assert.ok(starts>=2);
  assert.equal(starts,ends);
});
test('R134 keeps real R133 API calls operator-only on current main',()=>{
  assert.match(workflow,/^  workflow_dispatch:$/m);
  assert.match(workflow,/^  pull_request:$/m);
  assert.match(workflow,/github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/needs: offline-contract/);
  assert.doesNotMatch(workflow,/^\s+push:\s*$/m);
});
test('R134 runs all negative tests before any real GitHub API attestation',()=>{
  assert.match(workflow,/node --test tests\/r133_one_sha_automatic_evidence_gate\.test\.mjs tests\/r134_r133_github_expressions\.test\.mjs/);
  assert.match(workflow,/^    needs: offline-contract$/m);
  assert.match(workflow,/node ops\/r133_one_sha_automatic_evidence_gate\.mjs/);
});
test('R134 refuses to convert the automation into a production deployment',()=>{
  assert.match(workflow,/assert\.equal\(p\.productionCutoverAuthorized,false\)/);
  assert.match(workflow,/assert\.equal\(p\.productionDecision,'NO_GO'\)/);
  assert.match(workflow,/^  contents: read$/m);
  assert.doesNotMatch(workflow,/rsync --delete|ssh |service_role|MARCOSA_STAGING_HOST/);
});
test('R134 implementation checks exact main SHA, read-only GH_TOKEN, all 5 stage proofs',()=>{
  assert.match(source,/process\.env\.GH_TOKEN/);
  assert.match(source,/process\.env\.GITHUB_EVENT_NAME==='workflow_dispatch'/);
  assert.match(source,/checkout===sourceSha/);
  assert.match(source,/main\.object\?\.sha===sha/);
  assert.match(source,/after\.object\?\.sha===sha/);
  assert.match(source,/automaticEvidenceStages:5/);
  assert.match(source,/productionDecision:'NO_GO'/);
});
