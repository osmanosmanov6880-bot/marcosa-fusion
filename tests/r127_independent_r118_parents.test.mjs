import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTwoParents,extractParentIds,FORMAT,REPO}
  from '../ops/r127_independent_r118_parents.mjs';

const SHA='a'.repeat(40),INDEX='b'.repeat(64),ALT='c'.repeat(64);
function parent(runId,r121RunId){
  const r121Report={
    sourceSha:SHA,status:'PASS',verdict:'NO_GO',
    verifiedR118UpstreamRunId:runId,verifiedR118NonrootVpsAttestation:true,
    verifiedR118OldIndexSha256:INDEX,
    numberOfHashedPublicFiles:2,
    mainProductionRootCutoverAuthorized:false,
    customerStorageOrAuthInspected:false,
  };
  const report={
    format:'MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1',sourceSha:SHA,
    preliminaryAudit:'PASS',verifiedPreviewScope:'public_static_preview_only',
    productionDecision:'NO_GO',directRootReplacementAllowed:false,
    productionAuthorized:false,productionChanged:false,
    accountsMigratedOrVerified:false,databasesBackedUpAndRestored:false,
    checks:{
      r117TripleProof:'PASS',realProductionRootReadOnlyParity:'PASS',
      stageShaEqualsAuditedMain:true,
    },
    existingRoot:{
      indexSha256:INDEX,counts:{legacyPublicTopLevel:2},
      criticalPublicIntegrationNamesPresent:['nexus.js'],
    },
  };
  return {
    r121Report,r121RunId,
    parent:{
      run:{
        id:runId,
        name:'MARCOSA | R118 actual production compatibility audit (READ ONLY, NO CUTOVER)',
        head_sha:SHA,head_branch:'main',head_repository:{full_name:REPO},
        event:'workflow_dispatch',status:'completed',conclusion:'success',
      },
      jobs:{
        total_count:2,jobs:[
          {id:runId*10+1,name:'offline-contract',status:'completed',conclusion:'success',head_sha:SHA},
          {id:runId*10+2,name:'live-production-parity',status:'completed',conclusion:'success',head_sha:SHA},
        ],
      },
      artifacts:{
        total_count:1,artifacts:[{
          id:runId*10+3,name:'marcosa-r118-production-boundary-no-go',
          expired:false,size_in_bytes:2048,workflow_run:{id:runId},
        }],
      },
      report,
    },
  };
}
function sample(){
  const first=parent(900001,810001),second=parent(900002,810002);
  return {
    expectedSha:SHA,first,second,
    r122:{
      format:'MARCOSA-R122-DOUBLE-INDEPENDENT-REAL-VPS-PUBLIC-PROOF-v1',
      sourceSha:SHA,status:'PASS',productionDecision:'NO_GO',
      productionCutoverAuthorized:false,independentlyCompletedVpsJobs:true,
      runIds:[810001,810002],verifiedR118ParentRunIds:[900001,900002],
    },
  };
}
const rejects=(name,mutation,pattern)=>test(name,()=>{
  const data=sample();mutation(data);
  assert.throws(()=>verifyTwoParents(data),pattern);
});
test('R127 independently verifies two real, manually dispatched R118 jobs and artifacts',()=>{
  const result=verifyTwoParents(sample());
  assert.equal(result.format,FORMAT);
  assert.equal(result.status,'PASS');
  assert.deepEqual(result.r118ParentRunIds,[900001,900002]);
  assert.deepEqual(result.r121RunIds,[810001,810002]);
  assert.equal(result.independentlyVerifiedR118ApiAndRealVpsJobs,true);
  assert.equal(result.productionCutoverAuthorized,false);
  assert.equal(result.productionDecision,'NO_GO');
  assert.equal(result.authenticationOrDatabaseRecoveryProven,false);
  assert.doesNotMatch(JSON.stringify(result),/privateCustomerSecretToken/);
});
test('R127 selects only two distinct parent IDs after same SHA and PASS',()=>{
  const v=sample();
  assert.deepEqual(extractParentIds({expectedSha:SHA,
    first:v.first.r121Report,second:v.second.r121Report}),[900001,900002]);
  v.second.r121Report.verifiedR118UpstreamRunId=900001;
  assert.throws(()=>extractParentIds({expectedSha:SHA,
    first:v.first.r121Report,second:v.second.r121Report}),/distinct/);
});
rejects('refuses stale SHA in first R118 metadata',p=>{
  p.first.parent.run.head_sha='d'.repeat(40);
},/Untrusted/);
rejects('refuses upstream audit triggered by automated workflow cascade',p=>{
  p.first.parent.run.event='workflow_run';
},/explicitly dispatched/);
rejects('refuses R118 launched on PR branch',p=>{
  p.second.parent.run.head_branch='feature/evil';
},/Untrusted/);
rejects('refuses R118 from a different repository',p=>{
  p.second.parent.run.head_repository.full_name='another/repo';
},/Untrusted/);
rejects('refuses workflow-level green with skipped actual VPS job',p=>{
  p.second.parent.jobs.jobs[1].conclusion='skipped';
},/real read-only VPS job/);
rejects('refuses missing actual VPS job',p=>{
  p.first.parent.jobs.jobs.pop();p.first.parent.jobs.total_count=1;
},/Incomplete R118/);
rejects('refuses noncompleted VPS job',p=>{
  p.first.parent.jobs.jobs[1].status='queued';
},/real read-only VPS job/);
rejects('refuses incomplete GitHub jobs page',p=>{
  p.second.parent.jobs.total_count=101;
},/Incomplete R118/);
rejects('refuses incomplete GitHub artifacts page',p=>{
  p.second.parent.artifacts.total_count=101;
},/Incomplete R118 artifact listing/);
rejects('refuses missing R118 artifact',p=>{
  p.first.parent.artifacts.artifacts=[];p.first.parent.artifacts.total_count=0;
},/Incomplete R118 artifact listing/);
rejects('refuses expired R118 artifact',p=>{
  p.second.parent.artifacts.artifacts[0].expired=true;
},/NO_GO artifact/);
rejects('refuses artifact from unrelated GitHub run',p=>{
  p.first.parent.artifacts.artifacts[0].workflow_run.id=1;
},/NO_GO artifact/);
rejects('refuses missing artifact source run binding',p=>{
  delete p.first.parent.artifacts.artifacts[0].workflow_run;
},/NO_GO artifact/);
rejects('refuses duplicate same-run R118 artifacts',p=>{
  const z=p.first.parent.artifacts;
  z.artifacts.push({...z.artifacts[0],id:555});z.total_count=2;
},/NO_GO artifact/);
rejects('refuses unsafe R118 artifact claiming production approval',p=>{
  p.second.parent.report.productionAuthorized=true;
},/R118 artifact/);
rejects('refuses changed R118 index baseline',p=>{
  p.second.parent.report.existingRoot.indexSha256=ALT;
},/baseline mismatches/);
rejects('refuses incompatible R118 public file count',p=>{
  p.second.parent.report.existingRoot.counts.legacyPublicTopLevel=3;
},/baseline mismatches/);
rejects('refuses forged R121 parent run ID',p=>{
  p.first.r121Report.verifiedR118UpstreamRunId=11;
},/wrong-run R122/);
rejects('refuses wrong SHA in R121 report',p=>{
  p.first.r121Report.sourceSha='d'.repeat(40);
},/Trusted same-SHA/);
rejects('refuses R121 DRIFT',p=>{
  p.first.r121Report.status='DRIFT';
},/Trusted same-SHA/);
rejects('refuses R121 report claiming production GO',p=>{
  p.first.r121Report.mainProductionRootCutoverAuthorized=true;
},/R121 report/);
rejects('refuses R122 DRIFT even after two good parents',p=>{
  p.r122.status='DRIFT';
},/R122 public result/);
rejects('refuses mismatched R122 parent IDs',p=>{
  p.r122.verifiedR118ParentRunIds[1]=12345;
},/R122 public result/);
rejects('refuses R122 release permission',p=>{
  p.r122.productionCutoverAuthorized=true;
},/R122 public result/);
rejects('refuses identical VPS job ID reused under two R118 parent runs',p=>{
  p.second.parent.jobs.jobs[1].id=p.first.parent.jobs.jobs[1].id;
},/independent R118 live job IDs/);
rejects('refuses identical artifact ID under two R118 runs',p=>{
  p.second.parent.artifacts.artifacts[0].id=p.first.parent.artifacts.artifacts[0].id;
},/independent R118 live job IDs/);
