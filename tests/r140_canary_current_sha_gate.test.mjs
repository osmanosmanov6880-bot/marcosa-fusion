import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyR140Trigger,verifyR140Plan,R140_REPO,R140_STAGING_NAME,R140_NGINX_SHA}
  from '../ops/r140_canary_preflight_gate.mjs';

const SHA='a'.repeat(40),STALE='b'.repeat(40);
const accepted=()=>({eventName:'workflow_run',repository:R140_REPO,
 ref:'refs/heads/main',sourceSha:SHA,confirmation:'',
 payload:{action:'completed',workflow_run:{
   id:55,name:R140_STAGING_NAME,event:'push',head_branch:'main',
   head_repository:{full_name:R140_REPO},head_sha:SHA,
   status:'completed',conclusion:'success',
 }}});
const plan=()=>({
 sourceSha:SHA,beforeConfigSha256:R140_NGINX_SHA,
 afterConfigSha256:'d'.repeat(64),liveRootSha256:'e'.repeat(64),
 canaryPath:'/network-os/',rootReplacementAllowed:false,stagingAssetsVerified:63,
});
test('R140 accepts trusted successful exact-main STAGING completion',()=>{
 assert.equal(verifyR140Trigger(accepted()),'trusted_staging_completed');
});
test('R140 accepts explicitly authorized manual read-only current main',()=>{
 assert.equal(verifyR140Trigger({...accepted(),eventName:'workflow_dispatch',
 confirmation:'AUDIT-MARCOSA-CANARY-READONLY',payload:undefined}),'explicit_manual_main');
});
for(const [what,patch] of [
 ['wrong source SHA',x=>x.payload.workflow_run.head_sha=STALE],
 ['failed STAGING',x=>x.payload.workflow_run.conclusion='failure'],
 ['skipped STAGING',x=>x.payload.workflow_run.conclusion='skipped'],
 ['PR triggered STAGING',x=>x.payload.workflow_run.event='pull_request'],
 ['foreign source',x=>x.payload.workflow_run.head_repository.full_name='fake/fork'],
 ['non STAGING event',x=>x.payload.workflow_run.name='fake'],
 ['another repo',x=>x.repository='fake/repo'],
 ['another branch',x=>x.ref='refs/heads/other'],
 ['wrong action',x=>x.payload.action='requested'],
 ['bad workflow id',x=>x.payload.workflow_run.id=0],
 ['untrusted event',x=>x.eventName='pull_request'],
])test('R140 refuses '+what,()=>{
 const x=accepted();patch(x);
 assert.throws(()=>verifyR140Trigger(x));
});
test('R140 refuses manual without explicit confirmation',()=>{
 assert.throws(()=>verifyR140Trigger({...accepted(),eventName:'workflow_dispatch',
   confirmation:'',payload:undefined}));
});
test('R140 validates current actual VPS plan but never grants production',()=>{
 const r=verifyR140Plan({plan:plan(),sourceSha:SHA,currentMainSha:SHA});
 assert.equal(r.sourceSha,SHA);assert.equal(r.stagingAssetsVerified,63);
 assert.equal(r.productionDecision,'NO_GO');
});
test('R140 rejects previously successful R107 plan from prior main SHA',()=>{
 assert.throws(()=>verifyR140Plan({plan:{...plan(),sourceSha:STALE},
  sourceSha:SHA,currentMainSha:SHA}),/stale/);
});
test('R140 rejects main advanced after SSH report',()=>{
 assert.throws(()=>verifyR140Plan({plan:plan(),sourceSha:SHA,
  currentMainSha:STALE}),/current GitHub main differs/);
});
test('R140 rejects nginx digest drift and silent production GO',()=>{
 assert.throws(()=>verifyR140Plan({plan:{...plan(),
  beforeConfigSha256:'f'.repeat(64)},sourceSha:SHA,currentMainSha:SHA}));
 assert.throws(()=>verifyR140Plan({plan:{...plan(),
  productionAuthorized:true},sourceSha:SHA,currentMainSha:SHA}));
 assert.throws(()=>verifyR140Plan({plan:{...plan(),
  rootReplacementAllowed:true},sourceSha:SHA,currentMainSha:SHA}));
});
test('R140 refuses insufficient or fabricated size and plan',()=>{
 assert.throws(()=>verifyR140Plan({plan:{...plan(),
  stagingAssetsVerified:0},sourceSha:SHA,currentMainSha:SHA}));
 assert.throws(()=>verifyR140Plan({plan:{...plan(),
  stagingAssetsVerified:9000},sourceSha:SHA,currentMainSha:SHA}));
});
test('R140 workflow waits for real STAGING, never starts on push prematurely',()=>{
 const w=readFileSync(new URL('../.github/workflows/marcosa-r107-canary-plan.yml',import.meta.url),'utf8');
 assert.match(w,/workflow_run:/);
 assert.match(w,/types: \[completed\]/);
 assert.match(w,/github\.event\.workflow_run\.conclusion == 'success'/);
 assert.match(w,/github\.event\.workflow_run\.head_sha == github\.sha/);
 assert.match(w,/verifyR140Trigger/);
 assert.match(w,/verifyR140Plan/);
 assert.match(w,/sourceSha===process\.env\.RELEASE_SHA|verifyR140Plan\(\{/);
 assert.doesNotMatch(w,/^  push:/m);
 assert.match(w,/^  contents: read$/m);
 assert.match(w,/^  actions: read$/m);
 assert.doesNotMatch(w,/secrets\..*ROOT|sudo .*install_production_canary|MARCOSA-ADD-ONLY-CANARY/);
});
