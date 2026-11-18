import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateR163StagingCandidate} from '../r163/release-gate.mjs';
const now=1800000000000,commit='a'.repeat(40),bundleSha256='b'.repeat(64);
function candidate(){
 return{now,commit,bundleSha256,
  bundle:{verifiedAgainstCheckout:true,exactSourceBytes:true,sha256:bundleSha256,
   commit,productionAuthorized:false},
  review:{cryptographicSignatureVerified:true,reviewerKeyDistinctFromBuilder:true,
   commit,bundleSha256,productionAuthorized:false,humanIndependenceEstablished:false,
   validUntilMs:now+500000},
  readback:{readbackMatched:true,pinnedTlsTransportUsed:true,syntheticCiLoopback:true,
   commit,bundleSha256,observedAtMs:now,productionAuthorized:false},
  slo:{ready:true,healthyWindows:3,lastSampleAtMs:now,lastEvaluatedAtMs:now,
   productionAuthorized:false},
  restore:{passed:true,scope:'synthetic-ci',commit,bundleSha256,
   observedAtMs:now,productionAuthorized:false}
 };
}
test('R163 complete ephemeral CI proof remains CI_ONLY and NEVER deployment authorization',()=>{
 const result=evaluateR163StagingCandidate(candidate());
 assert.equal(result.decision,'CI_SIMULATION_COMPLETE');
 assert.equal(result.missing.length,0);
 assert.equal(result.productionAuthorized,false);
 assert.equal(result.independentHumanReviewEstablished,false);
 assert.equal(result.liveSupabaseVerified,false);
});
test('R163 check each six prerequisites independently, tamper and stale proof blocked',()=>{
 const base=candidate();
 const variants=[
  {commit:'short'},
  {bundle:{...base.bundle,sha256:'f'.repeat(64)}},
  {review:{...base.review,humanIndependenceEstablished:true}},
  {readback:{...base.readback,observedAtMs:now-300001}},
  {slo:{...base.slo,ready:false}},
  {restore:{...base.restore,passed:false}}
 ];
 for(const x of variants){
  const result=evaluateR163StagingCandidate({...base,...x});
  assert.equal(result.decision,'BLOCKED');
  assert.equal(result.productionAuthorized,false);
  assert.ok(result.missing.length>=1);
 }
 assert.equal(evaluateR163StagingCandidate().decision,'BLOCKED');
});
test('R163 genuinely distinct staging inputs only yield manual audit, not auto-deploy',()=>{
 const c=candidate();
 const result=evaluateR163StagingCandidate({...c,
  readback:{...c.readback,syntheticCiLoopback:false},
  restore:{...c.restore,scope:'independent-staging'}});
 assert.equal(result.decision,'READY_FOR_INDEPENDENT_STAGING_AUDIT');
 assert.equal(result.productionAuthorized,false);
 assert.equal(result.manualOperatorReviewRequired,true);
 assert.equal(result.paymentsEnabled,false);
 assert.equal(result.payoutsEnabled,false);
});
