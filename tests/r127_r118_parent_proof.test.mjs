import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {extractParentIds,verifyParentPair,FORMAT}
  from '../ops/r127_r118_parent_proof.mjs';
const SHA='a'.repeat(40);
const REPO='osmanosmanov6880-bot/marcosa-fusion';
const NAME='MARCOSA | R118 actual production compatibility audit (READ ONLY, NO CUTOVER)';
const R121='MARCOSA-R121-VERIFIED-PUBLIC-FILE-HASH-BASELINE-v1';
function report(id){
  return {format:R121,sourceSha:SHA,status:'PASS',verdict:'NO_GO',
    verifiedR118NonrootVpsAttestation:true,
    verifiedR118UpstreamRunId:id,noProductionChangesMade:true,
    mainProductionRootCutoverAuthorized:false};
}
function parent(id){
  return {
    run:{id,name:NAME,head_sha:SHA,head_branch:'main',
      head_repository:{full_name:REPO},event:'workflow_dispatch',
      status:'completed',conclusion:'success'},
    jobs:{total_count:2,jobs:[
      {id:id*10+1,name:'offline-contract',status:'completed',conclusion:'success',head_sha:SHA},
      {id:id*10+2,name:'live-production-parity',status:'completed',conclusion:'success',head_sha:SHA},
    ]},
    artifacts:{total_count:1,artifacts:[{
      id:id*10+3,name:'marcosa-r118-production-boundary-no-go',
      expired:false,size_in_bytes:2100,workflow_run:{id},
    }]},
    report:{format:'MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1',
      sourceSha:SHA,preliminaryAudit:'PASS',
      verifiedPreviewScope:'public_static_preview_only',
      productionDecision:'NO_GO',directRootReplacementAllowed:false,
      productionAuthorized:false,productionChanged:false,
      accountsMigratedOrVerified:false,databasesBackedUpAndRestored:false,
      checks:{r117TripleProof:'PASS',realProductionRootReadOnlyParity:'PASS',
        stageShaEqualsAuditedMain:true},
      existingRoot:{counts:{legacyPublicTopLevel:34},
        criticalPublicIntegrationNamesPresent:['nexus.js'],
        rawSensitiveData:'NEVER_ECHO_CUSTOMER_SECRETS'},
    },
  };
}
const pair=()=>({expectedSha:SHA,parentIds:[50001,50002],
  first:parent(50001),second:parent(50002)});
test('R127 extracts only two independent same-source R118 parent IDs',()=>{
  assert.deepEqual([...extractParentIds({
    expectedSha:SHA,firstReport:report(50001),secondReport:report(50002)})],
    [50001,50002]);
});
test('R127 rejects old, missing, repeated, unsafe R121 reported parent IDs',()=>{
  const a=report(50001),b=report(50001);
  assert.throws(()=>extractParentIds({expectedSha:SHA,firstReport:a,secondReport:b}),/distinct/);
  b.verifiedR118UpstreamRunId=50002;b.verifiedR118NonrootVpsAttestation=false;
  assert.throws(()=>extractParentIds({expectedSha:SHA,firstReport:a,secondReport:b}),/untrusted/);
  const c=report(50002);delete c.verifiedR118UpstreamRunId;
  assert.throws(()=>extractParentIds({expectedSha:SHA,firstReport:a,secondReport:c}),/untrusted/);
  const d=report(50002);d.sourceSha='b'.repeat(40);
  assert.throws(()=>extractParentIds({expectedSha:SHA,firstReport:a,secondReport:d}),/untrusted/);
});
test('R127 checks both true GitHub manual VPS jobs and same-run JSON evidence',()=>{
  const p=verifyParentPair(pair());
  assert.equal(p.format,FORMAT);
  assert.deepEqual(p.verifiedR118ParentRunIds,[50001,50002]);
  assert.equal(p.independentReadOnlyVpsJobsVerified,true);
  assert.equal(p.verifiedUsingGitHubApi,true);
  assert.equal(p.productionCutoverAuthorized,false);
  assert.equal(p.verdict,'NO_GO');
  assert.doesNotMatch(JSON.stringify(p),/NEVER_ECHO_/);
});
const refuses=(name,change,pattern)=>test(name,()=>{
  const p=pair();change(p);assert.throws(()=>verifyParentPair(p),pattern);
});
refuses('R118 must be manually dispatched, not an old chained offline-only run',
  p=>{p.first.run.event='workflow_run'},/operator-dispatched/);
refuses('R118 must use exact current main source SHA',
  p=>{p.second.run.head_sha='b'.repeat(40)},/Untrusted/);
refuses('R118 parent ID must match GitHub API run',
  p=>{p.first.run.id=90000},/Untrusted/);
refuses('R118 real VPS job cannot be skipped',
  p=>{p.second.jobs.jobs[1].conclusion='skipped'},/real read-only VPS job/);
refuses('R118 fake offline-only success is rejected',
  p=>{p.first.jobs.jobs.pop()},/Incomplete/);
refuses('R118 artifact cannot be expired',
  p=>{p.second.artifacts.artifacts[0].expired=true},/Missing live R118/);
refuses('R118 artifact must come from same exact run',
  p=>{p.first.artifacts.artifacts[0].workflow_run.id=9},/Missing live R118/);
refuses('R118 private-account migration flag cannot falsely authorize release',
  p=>{p.first.report.accountsMigratedOrVerified=true},/artifact/);
refuses('R118 parent run IDs must differ',
  p=>{p.parentIds=[50001,50001]},/Distinct bounded/);
test('R127 CLI refuses missing fixed evidence rather than claim PASS',()=>{
  const run=spawnSync(process.execPath,['ops/r127_r118_parent_proof.mjs','--verify'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:12000,
    env:{...process.env,GITHUB_REPOSITORY:REPO,RELEASE_SHA:SHA},
  });
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/R127_PARENT_ATTESTATION_REFUSED/);
  assert.doesNotMatch(run.stdout,/ATTESTATION=PASS/);
});
test('workflow independently fetches BOTH R118 parents and NO_GO artifacts before R122',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/marcosa-r122-two-real-vps-hash-proof.yml',
    import.meta.url),'utf8');
  assert.match(yaml,/node ops\/r127_r118_parent_proof\.mjs --extract/);
  assert.match(yaml,/node ops\/r127_r118_parent_proof\.mjs --verify/);
  assert.match(yaml,/marcosa-r118-production-boundary-no-go/);
  assert.match(yaml,/gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$parentid\/jobs\?per_page=100"/);
  assert.ok(yaml.indexOf('--verify')<yaml.lastIndexOf('node ops/r122_dual_vps_inventory_gate.mjs'));
  assert.doesNotMatch(yaml,/DEPLOY_SSH_KEY|sudo |rsync --delete|systemctl restart/);
});

refuses('R127 refuses incomplete R118 GitHub jobs page',p=>{
  p.first.jobs.total_count=3;
},/Incomplete R118 GitHub jobs page/);
refuses('R127 refuses incomplete R118 GitHub artifacts page',p=>{
  p.second.artifacts.total_count=2;
},/Incomplete R118 GitHub artifacts page/);
refuses('R127 refuses artifact with no same-run workflow identity',p=>{
  delete p.first.artifacts.artifacts[0].workflow_run;
},/exact parent run/);
refuses('R127 refuses two real parent runs reusing the same VPS job ID',p=>{
  p.second.jobs.jobs[1].id=p.first.jobs.jobs[1].id;
},/Distinct real R118 VPS job and artifact IDs/);
refuses('R127 refuses two real parent runs reusing the same artifact ID',p=>{
  p.second.artifacts.artifacts[0].id=p.first.artifacts.artifacts[0].id;
},/Distinct real R118 VPS job and artifact IDs/);
