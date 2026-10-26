import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateGate,STAGES,MANUAL_BLOCKERS,FORMAT,REPO}
 from '../ops/r133_one_sha_automatic_evidence_gate.mjs';

const SHA='a'.repeat(40),PREV='b'.repeat(40);
function fixture(){
  const evidence={};
  let n=1001;
  for(const [key,stage] of Object.entries(STAGES)){
    const id=n++;
    const jobs=stage.jobs.map((name,i)=>({
      id:id*10+i+1,name,head_sha:SHA,
      status:'completed',conclusion:'success',
    }));
    const run={
      id,name:stage.name,head_sha:SHA,head_branch:'main',
      head_repository:{full_name:REPO},event:stage.event,
      status:'completed',conclusion:'success',
    };
    let artifacts,report;
    if(key==='r114'){
      artifacts={total_count:1,artifacts:[{
        id:id*10+8,name:stage.artifact,expired:false,
        size_in_bytes:743,workflow_run:{id},
      }]};
      report={
        format:'MARCOSA-R114-DUAL-RELEASE-EVIDENCE-v1',
        sourceSha:SHA,mainSha:SHA,currentMain:true,status:'PASS',
        channels:{pages:{status:'PASS'},staging:{status:'PASS'}},
        sourceBasedPublicPagesVerified:true,
        sourceBasedRestrictedStagingVerified:true,
        productionAuthorized:false,productionCutoverVerified:false,
        privateAccountsOrDatabaseVerified:false,
      };
    }else if(key==='r116'){
      artifacts={total_count:1,artifacts:[{
        id:id*10+8,name:stage.artifact,expired:false,
        size_in_bytes:477,workflow_run:{id},
      }]};
      report={
        format:'MARCOSA-R116-ACTUAL-NONROOT-VPS-ROLLBACK-PROOF-v1',
        sourceSha:SHA,previousReleaseSha:PREV,
        rollbackCandidateAssetsVerified:63,
        actualReadOnlyVpsSshCheck:true,
        previousFilesAndManifestSha256Verified:true,
        productionChanged:false,productionAuthorized:false,
        status:'PASS',
      };
    }
    evidence[key]={run,jobs:{total_count:jobs.length,jobs},artifacts,report};
  }
  return {sourceSha:SHA,currentMainSha:SHA,evidence};
}
const reject=(name,change,expected)=>test(name,()=>{
  const x=fixture();change(x);
  assert.throws(()=>evaluateGate(x),expected);
});
test('R133 accepts only 5 distinct, genuine, exact-main automation proofs',()=>{
  const result=evaluateGate(fixture());
  assert.equal(result.format,FORMAT);
  assert.equal(result.automaticEvidenceStages,5);
  assert.equal(result.status,'AUTOMATIC_PREVIEW_AND_READONLY_ROLLBACK_PROOFS_PASS');
  assert.deepEqual(Object.keys(result.stages),Object.keys(STAGES));
  assert.ok(Object.values(result.stages).every(x=>x.status==='PASS'));
  assert.equal(result.requiredManualEvidenceNotProven.length,MANUAL_BLOCKERS.length);
  assert.equal(result.productionDecision,'NO_GO');
  assert.equal(result.productionCutoverAuthorized,false);
  assert.equal(result.realCustomerAuthStorageOrDatabaseMigrated,false);
  assert.doesNotMatch(JSON.stringify(result),/examplePassword|secret|privateToken/);
});
test('R133 repeated inspection is deterministic and never claims user GO',()=>{
  assert.deepEqual(evaluateGate(fixture()),evaluateGate(fixture()));
  assert.equal(evaluateGate(fixture()).privateProductionDataInspected,false);
});
reject('old main SHA is forbidden',x=>x.currentMainSha=PREV,/current main SHA/);
reject('malformed SHA is forbidden',x=>x.sourceSha='abc',/current main SHA/);
reject('missing independent job evidence is forbidden',x=>delete x.evidence.r48,/workflow missing/);
reject('wrong R48 workflow is forbidden',x=>x.evidence.r48.run.name='attacker',/workflow missing/);
reject('stale Pages SHA is forbidden',x=>x.evidence.pages.run.head_sha=PREV,/workflow missing/);
reject('foreign repository on STAGING is forbidden',x=>{
 x.evidence.staging.run.head_repository.full_name='other/repo';
},/workflow missing/);
reject('non-main R116 is forbidden',x=>x.evidence.r116.run.head_branch='test',/workflow missing/);
reject('R116 may not be a pull request',x=>x.evidence.r116.run.event='pull_request',/workflow missing/);
reject('R116 workflow-level success with SKIPPED VPS job refused',x=>{
 x.evidence.r116.jobs.jobs[1].conclusion='skipped';
},/real required job read-only-vps-proof/);
reject('Pages workflow-level success with skipped publish refused',x=>{
 x.evidence.pages.jobs.jobs[1].conclusion='skipped';
},/real required job publish/);
reject('STAGING missing restricted SSH job refused',x=>{
 x.evidence.staging.jobs.jobs.pop();
 x.evidence.staging.jobs.total_count=1;
},/real required job deploy_ssh_filesystem/);
reject('queued real VPS job refused',x=>{
 x.evidence.r116.jobs.jobs[1].status='queued';
},/real required job read-only-vps-proof/);
reject('duplicate required Pages job refused',x=>{
 const p=x.evidence.pages.jobs;
 p.jobs.push({...p.jobs[1],id:90999});p.total_count++;
},/real required job publish/);
reject('wrong SHA in actual VPS job refused',x=>{
 x.evidence.r116.jobs.jobs[1].head_sha=PREV;
},/real required job read-only-vps-proof/);
reject('incomplete paginated GH job list refused',x=>{
 x.evidence.r116.jobs.total_count=100;
},/Incomplete GitHub jobs/);
reject('oversized GH job list refused',x=>{
 const e=x.evidence.r48.jobs;
 e.jobs=Array.from({length:101},(_,i)=>({...e.jobs[0],id:7000+i}));
 e.total_count=101;
},/Incomplete GitHub jobs/);
reject('duplicate run ID used for different proof stages refused',x=>{
 x.evidence.pages.run.id=x.evidence.r48.run.id;
},/workflow missing/);
reject('R114 report PENDING while workflow green refused',x=>{
 x.evidence.r114.report.status='PENDING';
},/R114 needs actual/);
reject('R114 Pages public byte readback not proven refused',x=>{
 x.evidence.r114.report.channels.pages.status='PENDING';
},/R114 needs actual/);
reject('R114 mismatched main SHA refused',x=>{
 x.evidence.r114.report.mainSha=PREV;
},/R114 needs actual/);
reject('R114 no actual report refused',x=>{
 delete x.evidence.r114.report;
},/downloaded bounded artifact/);
reject('R116 historical older source rejected',x=>{
 x.evidence.r116.report.sourceSha=PREV;
},/R116 needs actual/);
reject('R116 no actual VPS SSH rejected',x=>{
 x.evidence.r116.report.actualReadOnlyVpsSshCheck=false;
},/R116 needs actual/);
reject('R116 reports production change rejected',x=>{
 x.evidence.r116.report.productionChanged=true;
},/R116 needs actual/);
reject('R116 reports production authorized rejected',x=>{
 x.evidence.r116.report.productionAuthorized=true;
},/R116 needs actual/);
reject('R116 not enough rollback files rejected',x=>{
 x.evidence.r116.report.rollbackCandidateAssetsVerified=0;
},/R116 needs actual/);
reject('R116 previous SHA equals source rejected',x=>{
 x.evidence.r116.report.previousReleaseSha=SHA;
},/R116 needs actual/);
reject('R116 current SHA artifact expired rejected',x=>{
 x.evidence.r116.artifacts.artifacts[0].expired=true;
},/GitHub artifact/);
reject('R116 artifact from a different Actions run rejected',x=>{
 x.evidence.r116.artifacts.artifacts[0].workflow_run.id=99;
},/GitHub artifact/);
reject('R116 multiple same-name artifacts rejected',x=>{
 const o=x.evidence.r116.artifacts;
 o.artifacts.push({...o.artifacts[0],id:60001});o.total_count=2;
},/GitHub artifact/);
reject('R116 wrong artifact name rejected',x=>{
 x.evidence.r116.artifacts.artifacts[0].name='fake';
},/GitHub artifact/);
reject('R114 missing artifact rejected',x=>{
 x.evidence.r114.artifacts.artifacts=[];x.evidence.r114.artifacts.total_count=0;
},/GitHub artifact/);
reject('R114 artifact source run mismatch rejected',x=>{
 x.evidence.r114.artifacts.artifacts[0].workflow_run.id=345;
},/GitHub artifact/);
reject('R114 incomplete paginated GH artifacts refused',x=>{
 x.evidence.r114.artifacts.total_count=100;
},/Incomplete GitHub artifact/);
reject('R114 artifact byte size outside bound refused',x=>{
 x.evidence.r114.artifacts.artifacts[0].size_in_bytes=100000;
},/GitHub artifact/);
reject('R114 green workflow without all completed required jobs refused',x=>{
 x.evidence.r114.jobs.jobs[1].status='in_progress';
},/real required job release-evidence/);
