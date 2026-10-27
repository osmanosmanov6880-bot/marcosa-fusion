import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {awaitR133Inputs,R136_REPO} from '../ops/r136_trusted_r116_trigger.mjs';
import {STAGES} from '../ops/r133_one_sha_automatic_evidence_gate.mjs';

const SHA='a'.repeat(40);
const OTHER='b'.repeat(40);
const stageKeys=Object.keys(STAGES);
const single=(key,{status='completed',conclusion='success',sha=SHA,repo=R136_REPO,id=123}={})=>({
  total_count:1,workflow_runs:[{
    id,name:STAGES[key].name,event:STAGES[key].event,head_branch:'main',
    head_repository:{full_name:repo},head_sha:sha,status,conclusion,
  }],
});
const keyOf=path=>stageKeys.find(k=>path.includes('/'+STAGES[k].file+'/'));
const context=(alter={},attempts=2)=>({
  sourceSha:SHA,stages:STAGES,attempts,
  getCurrentMain:async()=>SHA,pause:async()=>{},
  listRuns:async path=>single(keyOf(path),alter[keyOf(path)]||{}),
});

test('R137 five-stage exact SHA immediate read-only readiness is NOT production GO',async()=>{
  const result=await awaitR133Inputs(context());
  assert.equal(result.status,'READY_FOR_R133_STRICT_JOB_ARTIFACT_VERIFICATION');
  assert.equal(result.stagesReady,5);
  assert.equal(result.attempt,1);
  assert.equal(result.productionDecision,'NO_GO');
  assert.deepEqual(Object.keys(result).sort(),
    ['sourceSha','stagesReady','attempt','status','productionDecision'].sort());
});
test('R137 waits when Pages publish byte-readback is still in progress',async()=>{
  let pagesReads=0,sleeps=0;
  const x=context();
  x.listRuns=async path=>{
    const k=keyOf(path);
    if(k==='pages'&&++pagesReads===1)
      return single(k,{status:'in_progress',conclusion:null});
    return single(k);
  };
  x.pause=async ms=>{assert.equal(ms,15000);sleeps++;};
  const r=await awaitR133Inputs(x);
  assert.equal(r.attempt,2);
  assert.equal(sleeps,1);
  assert.equal(pagesReads,2);
});
test('R137 missing Pages never becomes fake green after timeout',async()=>{
  const x=context({},2);
  x.listRuns=async path=>keyOf(path)==='pages'?
    {total_count:0,workflow_runs:[]}:single(keyOf(path));
  await assert.rejects(awaitR133Inputs(x),/timed out waiting/);
});
test('R137 refuses actual failed Pages even when other stages passed',async()=>{
  await assert.rejects(awaitR133Inputs(context({
    pages:{status:'completed',conclusion:'failure'},
  })),/pages.*failed/);
});
test('R137 refuses latest failed Pages if historical success exists',async()=>{
  const x=context();
  x.listRuns=async path=>{
    const k=keyOf(path);
    if(k!=='pages')return single(k);
    const good=single(k,{id:50}).workflow_runs[0];
    const bad=single(k,{id:51,conclusion:'failure'}).workflow_runs[0];
    return {total_count:2,workflow_runs:[good,bad]};
  };
  await assert.rejects(awaitR133Inputs(x),/pages.*failed/);
});
test('R137 refuses main changing between checks',async()=>{
  let c=0;
  const x=context();
  x.getCurrentMain=async()=>++c===1?SHA:OTHER;
  await assert.rejects(awaitR133Inputs(x),/main advanced/);
});
test('R137 refuses superseded SHA on first call',async()=>{
  const x=context();
  x.getCurrentMain=async()=>OTHER;
  await assert.rejects(awaitR133Inputs(x),/main changed/);
});
test('R137 refuses foreign repository despite reported success',async()=>{
  const x=context({pages:{repo:'untrusted/repo'}},1);
  await assert.rejects(awaitR133Inputs(x),/timed out/);
});
test('R137 refuses wrong source SHA even when workflow claims PASS',async()=>{
  const x=context({r116:{sha:OTHER}},1);
  await assert.rejects(awaitR133Inputs(x),/timed out/);
});
test('R137 refuses incomplete page rather than optimistic PASS',async()=>{
  const x=context();
  x.listRuns=async path=>{
    const p=single(keyOf(path));
    return {...p,total_count:2};
  };
  await assert.rejects(awaitR133Inputs(x),/incomplete/);
});
test('R137 refuses extra stages and unbounded retries',async()=>{
  await assert.rejects(awaitR133Inputs({...context(),stages:{...STAGES,hacked:STAGES.r48}}),/exactly five/);
  await assert.rejects(awaitR133Inputs({...context(),attempts:100}),/bounded/);
});
test('R137 workflow explicitly waits all five stages, then executes the strict R133 validator',()=>{
  const y=readFileSync(new URL('../.github/workflows/marcosa-r136-auto-proof.yml',import.meta.url),'utf8');
  assert.match(y,/Await R48 Pages STAGING R114 R116/);
  assert.match(y,/awaitR133Inputs/);
  assert.match(y,/import \{STAGES\} from '.\/ops\/r133_one_sha_automatic_evidence_gate.mjs'/);
  assert.match(y,/node ops\/r133_one_sha_automatic_evidence_gate.mjs/);
  assert.match(y,/R137_FIVE_STAGE_READINESS=PASS/);
  assert.match(y,/^  contents: read$/m);
  assert.match(y,/^  actions: read$/m);
  assert.doesNotMatch(y,/secrets\.|rsync|ssh |service_role|productionCutoverAuthorized,true/);
});
