import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyR136Trigger,awaitR114,R136_REPO,R136_R116_NAME,R136_R114_NAME}
 from '../ops/r136_trusted_r116_trigger.mjs';
const SHA='a'.repeat(40);
const good={eventName:'workflow_run',repository:R136_REPO,ref:'refs/heads/main',sourceSha:SHA,
 payload:{action:'completed',workflow_run:{name:R136_R116_NAME,event:'workflow_run',
 head_branch:'main',head_repository:{full_name:R136_REPO},head_sha:SHA,
 status:'completed',conclusion:'success',id:1234}}};
const snapshot=()=>structuredClone(good);
test('R136 trusted completed R116 exact-main accepted',()=>assert.equal(verifyR136Trigger(snapshot()),'trusted_r116_completed'));
test('R136 manual operator still accepted',()=>assert.equal(verifyR136Trigger({...good,eventName:'workflow_dispatch',payload:undefined}),'manual'));
for(const [what,change] of [
 ['stale SHA',x=>x.payload.workflow_run.head_sha='b'.repeat(40)],
 ['foreign repo',x=>x.payload.workflow_run.head_repository.full_name='bad/repo'],
 ['failed R116',x=>x.payload.workflow_run.conclusion='failure'],
 ['skipped R116',x=>x.payload.workflow_run.conclusion='skipped'],
 ['PR event',x=>x.payload.workflow_run.event='pull_request'],
 ['wrong workflow',x=>x.payload.workflow_run.name='fake'],
 ['untrusted webhook',x=>x.eventName='pull_request'],
 ['untrusted action',x=>x.payload.action='requested'],
 ['untrusted branch',x=>x.ref='refs/heads/other'],
 ['bad run id',x=>x.payload.workflow_run.id=0],
])test('R136 refuses '+what,()=>{const x=snapshot();change(x);assert.throws(()=>verifyR136Trigger(x))});
const report=(status,conclusion)=>({total_count:1,workflow_runs:[{
 id:45,name:R136_R114_NAME,event:'workflow_run',head_branch:'main',
 head_repository:{full_name:R136_REPO},head_sha:SHA,status,conclusion,
}]});
test('R136 waits for R114, never accepts queued as passed',async()=>{
 let n=0,pause=0;
 const r=await awaitR114({sourceSha:SHA,attempts:3,
  listRuns:async()=>++n===1?report('queued',null):report('completed','success'),
  pause:async ms=>{assert.equal(ms,15000);pause++;}});
 assert.deepEqual(r,{runId:45,attempt:2});assert.equal(pause,1);
});
test('R136 refuses completed failed R114 after bounded attempts',async()=>{
 await assert.rejects(awaitR114({sourceSha:SHA,attempts:2,
 listRuns:async()=>report('completed','failure'),pause:async()=>{}}),/did not complete successfully/);
});
test('R136 refuses incomplete pagination rather than false PASS',async()=>{
 await assert.rejects(awaitR114({sourceSha:SHA,attempts:1,
 listRuns:async()=>({total_count:2,workflow_runs:report('completed','success').workflow_runs}),
 pause:async()=>{}}),/incomplete/);
});
test('R136 workflow is read-only, chained only to R116',()=>{
 const y=readFileSync(new URL('../.github/workflows/marcosa-r136-auto-proof.yml',import.meta.url),'utf8');
 assert.match(y,/workflow_run:/);assert.match(y,/types: \[completed\]/);
 assert.match(y,/^  contents: read$/m);assert.match(y,/^  actions: read$/m);
 assert.match(y,/github\.event\.workflow_run\.conclusion == 'success'/);
 assert.doesNotMatch(y,/secrets\.|rsync|ssh |service_role|pull_request:|deploy_ssh_filesystem/);
 assert.match(y,/node ops\/r133_one_sha_automatic_evidence_gate\.mjs/);
 assert.match(y,/productionDecision,'NO_GO'/);
});
