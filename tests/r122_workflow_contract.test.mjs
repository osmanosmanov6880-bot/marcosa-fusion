import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/marcosa-r122-two-real-vps-hash-proof.yml',import.meta.url),'utf8');
test('R122 requires explicit TWO R121 run IDs, not automatic workflow chains',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/r121_run_a:/);
  assert.match(workflow,/r121_run_b:/);
  assert.doesNotMatch(workflow,/^\s+workflow_run:/m);
  assert.match(workflow,/\[\[ "\$R121_RUN_A" != "\$R121_RUN_B" \]\]/);
});
test('R122 never reports production GO or touches production services',()=>{
  assert.match(workflow,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.doesNotMatch(workflow,/DEPLOY_SSH_KEY|sudo |rsync|systemctl|ssh -|curl -X POST|contents: write|id-token: write|Nginx|DNS/);
  assert.match(workflow,/NO CUTOVER/);
});
test('PR CI runs offline only, while real proof requires dispatch on main',()=>{
  assert.match(workflow,/github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/node --test tests\/r122_dual_vps_inventory_gate\.test\.mjs/);
  assert.match(workflow,/node --test tests\/r122_workflow_contract\.test\.mjs/);
});
test('R122 fetches exact two run artifacts and validates them in Node',()=>{
  assert.match(workflow,/actions\/runs\/\$runid\/jobs\?per_page=100/);
  assert.match(workflow,/actions\/runs\/\$runid\/artifacts\?per_page=100/);
  assert.match(workflow,/gh run download "\$runid"/);
  assert.match(workflow,/node ops\/r122_dual_vps_inventory_gate\.mjs/);
  assert.match(workflow,/node ops\/r127_r118_parent_proof\.mjs --extract/);
  assert.match(workflow,/node ops\/r127_r118_parent_proof\.mjs --verify/);
  assert.match(workflow,/gh run download "\$parentid"/);
  assert.match(workflow,/R118_PARENTS/);
  assert.match(workflow,/"\$\(git rev-parse HEAD\)" == "\$RELEASE_SHA"/);
  assert.match(workflow,/if-no-files-found: warn/);
});
