import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {awaitR114ActualPass,R136_REPO,R136_R114_NAME} from '../ops/r136_trusted_r116_trigger.mjs';

const SHA='a'.repeat(40),OTHER='b'.repeat(40);
const report=(status='PASS')=>({
  format:'MARCOSA-R114-DUAL-RELEASE-EVIDENCE-v1',
  sourceSha:SHA,mainSha:SHA,currentMain:true,status,
  channels:{pages:{status:status==='PASS'?'PASS':'PENDING'},
    staging:{status:'PASS'}},
  sourceBasedPublicPagesVerified:status==='PASS',
  sourceBasedRestrictedStagingVerified:true,
  productionAuthorized:false,productionCutoverVerified:false,
  privateAccountsOrDatabaseVerified:false,
});
const listing=(id=300)=>({total_count:1,workflow_runs:[{
  id,name:R136_R114_NAME,event:'workflow_run',head_branch:'main',
  head_repository:{full_name:R136_REPO},head_sha:SHA,
  status:'completed',conclusion:'success',
}]});
const fixture=()=>({sourceSha:SHA,attempts:2,
  listRuns:async()=>listing(),
  loadProof:async()=>report(),
  getCurrentMain:async()=>SHA,
  pause:async()=>{},
});
test('R138 current-SHA actual R114 PASS allows only a strict R133 verification, never GO',async()=>{
  const r=await awaitR114ActualPass(fixture());
  assert.deepEqual(r,{sourceSha:SHA,r114RunId:300,status:'R114_ACTUAL_SAME_SHA_PAYLOAD_PASS',
    productionDecision:'NO_GO'});
});
test('R138 waits for new R114 PASS after earlier successful workflow uploaded PENDING report',async()=>{
  let count=0,sleeps=0;
  const x=fixture();x.loadProof=async()=>++count===1?report('PENDING'):report();
  x.pause=async ms=>{assert.equal(ms,15000);sleeps++};
  const r=await awaitR114ActualPass(x);
  assert.equal(r.r114RunId,300);assert.equal(count,2);assert.equal(sleeps,1);
});
test('R138 does not convert forever PENDING R114 into proof',async()=>{
  const x=fixture();x.loadProof=async()=>report('PENDING');
  await assert.rejects(awaitR114ActualPass(x),/no actual PASS/);
});
test('R138 explicitly rejects R114 terminal FAIL payload',async()=>{
  const x=fixture();x.loadProof=async()=>report('FAIL');
  await assert.rejects(awaitR114ActualPass(x),/terminal R114/);
});
test('R138 rejects R114 with wrong main SHA',async()=>{
  const x=fixture();x.loadProof=async()=>({...report(),mainSha:OTHER});
  await assert.rejects(awaitR114ActualPass(x),/invalid actual R114/);
});
test('R138 rejects R114 falsely granting production access',async()=>{
  const x=fixture();x.loadProof=async()=>({...report(),productionAuthorized:true});
  await assert.rejects(awaitR114ActualPass(x),/unsafe release flags/);
});
test('R138 rejects self-declared PASS without both source-backed channels',async()=>{
  const x=fixture();
  x.loadProof=async()=>({...report(),channels:{pages:{status:'PENDING'},staging:{status:'PASS'}}});
  await assert.rejects(awaitR114ActualPass(x),/missing verified Pages/);
});
test('R138 refuses latest failed R114 even if older run was good',async()=>{
  const x=fixture();
  const old=listing(300).workflow_runs[0];
  x.listRuns=async()=>({total_count:2,workflow_runs:[old,{...old,id:301,conclusion:'failure'}]});
  await assert.rejects(awaitR114ActualPass(x),/newest actual R114 run failed/);
});
test('R138 rejects missing source run and incomplete pagination',async()=>{
  const x=fixture();x.listRuns=async()=>({total_count:0,workflow_runs:[]});
  await assert.rejects(awaitR114ActualPass(x),/no actual PASS/);
  const y=fixture();y.listRuns=async()=>({total_count:2,workflow_runs:listing().workflow_runs});
  await assert.rejects(awaitR114ActualPass(y),/incomplete/);
});
test('R138 rejects upstream foreign repo despite success',async()=>{
  const x=fixture();x.listRuns=async()=>{
    const l=listing();l.workflow_runs[0].head_repository.full_name='bad/repo';return l;
  };
  await assert.rejects(awaitR114ActualPass(x),/no actual PASS/);
});
test('R138 refuses moved current main after loading valid actual artifact',async()=>{
  const x=fixture();let n=0;x.getCurrentMain=async()=>++n===1?SHA:OTHER;
  await assert.rejects(awaitR114ActualPass(x),/main moved/);
});
test('R138 workflow downloads only bounded named R114 report and then runs strict R133',()=>{
  const y=readFileSync(new URL('../.github/workflows/marcosa-r136-auto-proof.yml',import.meta.url),'utf8');
  assert.match(y,/awaitR114ActualPass/);
  assert.match(y,/marcosa-r114-release-evidence\.json/);
  assert.match(y,/match\[0\]\.workflow_run\?\.id!==run\.id/);
  assert.match(y,/R138_R114_ACTUAL_PAYLOAD=PASS/);
  assert.match(y,/node ops\/r133_one_sha_automatic_evidence_gate\.mjs/);
  assert.match(y,/^  actions: read$/m);
  assert.match(y,/^  contents: read$/m);
  assert.doesNotMatch(y,/secrets\.|rsync --delete|service_role/);
});
