import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../.github/workflows/'+path,import.meta.url),'utf8');
const on=yaml=>yaml.split('on:\n')[1].split('permissions:\n')[0];
for(const file of ['marcosa-r117-release-certificate.yml','marcosa-r118-production-boundary.yml']){
  test(file+' requires explicit main-only dispatch for real evidence',()=>{
    const yaml=read(file),trigger=on(yaml);
    assert.doesNotMatch(trigger,/^  workflow_run:/m);
    assert.match(trigger,/^  workflow_dispatch:/m);
    assert.match(trigger,/^  pull_request:/m);
    assert.match(yaml,/github.event_name == 'workflow_dispatch'/);
    assert.match(yaml,/github.ref == 'refs\/heads\/main'/);
    assert.match(yaml,/ref: main/);
    assert.match(yaml,/RELEASE_SHA:.*github.sha/);
    assert.doesNotMatch(yaml,/github.event_name == 'workflow_run'/);
  });
}
test('manual R118 independently verifies current R117 before read-only pinned SSH',()=>{
  const yaml=read('marcosa-r118-production-boundary.yml');
  assert.match(yaml,/node ops\/release_certificate_r117\.mjs/);
  assert.match(yaml,/git rev-parse HEAD/);
  assert.match(yaml,/StrictHostKeyChecking=yes/);
  assert.doesNotMatch(yaml,/rsync --delete|sudo |systemctl restart/);
});
for(const file of ['marcosa-r119-vps-social-smoke.yml','marcosa-r120-legacy-root-guard.yml','marcosa-r121-full-legacy-hash-inventory.yml']){
  test(file+' will only follow an actual manually initiated main R118',()=>{
    const yaml=read(file);
    assert.match(on(yaml),/^  workflow_run:/m);
    assert.match(yaml,/github.event.workflow_run.event == 'workflow_dispatch'/);
    assert.match(yaml,/github.event.workflow_run.head_branch == 'main'/);
    assert.match(yaml,/github.event.workflow_run.conclusion == 'success'/);
    assert.match(yaml,/node ops\/r123_upstream_live_gate\.mjs/);
    assert.match(yaml,/cancel-in-progress: false/);
  });
}
test('R123 still demands actual R118 VPS-job and unexpired same-run NO_GO artifact',()=>{
  const source=readFileSync(new URL('../ops/r123_upstream_live_gate.mjs',import.meta.url),'utf8');
  assert.match(source,/run.event==='workflow_dispatch'/);
  assert.match(source,/live\[0\].conclusion==='success'/);
  assert.match(source,/offline\[0\].conclusion==='success'/);
  assert.match(source,/found\[0\].expired===false/);
  assert.match(source,/report.productionDecision==='NO_GO'/);
});
test('R116 keeps genuine STAGING source and fails on obsolete source SHA',()=>{
  const yaml=read('marcosa-r116-rollback-readiness.yml');
  assert.match(on(yaml),/^  workflow_run:/m);
  assert.match(yaml,/R116_PREVIOUS_RUN_SUPERSEDED=BLOCKED/);
  assert.match(yaml,/R116_PREVIOUS_RUN_SUPERSEDED=BLOCKED[\s\S]*?exit 2/);
});
test('R125 is part of real R118 offline CI',()=>{
  assert.match(read('marcosa-r118-production-boundary.yml'),/node --test tests\/r125_manual_release_chain\.test\.mjs/);
});
