import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateR164OperationsAudit} from '../r164/operations-audit.mjs';
const t=1800000000000,commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const target=()=>({digest:'c'.repeat(64),commit,bundleSha256,
 productionAuthorized:false,externalDeploymentVerified:false,synthetic:true});
const fixture=()=>({now:t,commit,bundleSha256,target:target(),
 quorum:{signatureCount:2,distinctPinnedKeys:true,commit,targetDigest:'c'.repeat(64),
  expiry:t+100000,synthetic:true,productionAuthorized:false},
 restore:{passed:true,commit,bundleSha256,independentRestoreDatabase:true,
  scope:'synthetic-ci',observedAtMs:t-500,productionAuthorized:false,
  encryptedOffsiteCopyVerified:false},
 rollback:{shutdownVerified:true,mutationReady:false,phase:'stopped',
  productionAuthorized:false},
 priorReleaseGate:{decision:'CI_SIMULATION_COMPLETE',commit,syntheticEvidence:true,
  manualOperatorReviewRequired:true,productionAuthorized:false}});
test('R164 complete synthetic operational proof remains only CI REHEARSAL',()=>{
 const a=evaluateR164OperationsAudit(fixture());
 assert.equal(a.decision,'CI_REHEARSAL_COMPLETE');
 assert.equal(a.productionAuthorized,false);
 assert.equal(a.mustApproveManually,true);
 assert.equal(a.liveSupabaseVerified,false);
});
test('R164 failure in any independent area blocks release',()=>{
 const f=fixture();
 const changes=[
  {commit:'short'},
  {target:{...f.target,digest:'notsha'}},
  {quorum:{...f.quorum,signatureCount:1}},
  {restore:{...f.restore,observedAtMs:t-1000000}},
  {rollback:{...f.rollback,shutdownVerified:false}},
  {priorReleaseGate:{...f.priorReleaseGate,decision:'BLOCKED'}}
 ];
 for(const change of changes){
  const a=evaluateR164OperationsAudit({...f,...change});
  assert.equal(a.decision,'BLOCKED');assert.equal(a.productionAuthorized,false);
  assert.ok(a.missing.length>=1);
 }
 assert.equal(evaluateR164OperationsAudit().decision,'BLOCKED');
});
test('R164 even non-synthetic evidence still mandates independent human review',()=>{
 const f=fixture();
 const a=evaluateR164OperationsAudit({...f,
  target:{...f.target,synthetic:false},
  quorum:{...f.quorum,synthetic:false},
  restore:{...f.restore,scope:'independent-staging'},
  priorReleaseGate:{...f.priorReleaseGate,decision:'READY_FOR_INDEPENDENT_STAGING_AUDIT',
   syntheticEvidence:false}});
 assert.equal(a.decision,'READY_FOR_INDEPENDENT_HUMAN_STAGING_REVIEW');
 assert.equal(a.externalDeploymentAllowed,false);
 assert.equal(a.productionAuthorized,false);
 assert.equal(a.humanIdentityVerified,false);
});
