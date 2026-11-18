import test from 'node:test';
import assert from 'node:assert/strict';
import {assessR155Cutover,R155_REQUIRED_CHECKS} from '../r155/cutover-gate.mjs';

const sha='a'.repeat(40),digest='b'.repeat(64);
const evidence=()=>R155_REQUIRED_CHECKS.map(name=>({name,sha,conclusion:'success',artifactSha256:digest}));
const syntheticBestCase={
 repository:'osmanosmanov6880-bot/marcosa-fusion',sourceRef:'refs/heads/main',commitSha:sha,
 checks:evidence(),migrationChecksum:digest,restoredPgDumpChecksum:digest,
 independentReviewerId:'reviewer-demo-2026',reviewerSeparateFromOperator:true,
 authMigrationReviewed:true,realBackupsRestored:true,liveIdentityBridgeVerified:true,
 stagingTlsAndHostPinVerified:true,productionRequested:false
};
test('R155 no proof -> NO_GO: never creates users, connections, payments or deployments',()=>{
 const state=assessR155Cutover();
 assert.equal(state.assessment,'NO_GO');
 assert.equal(state.productionCutoverAuthorized,false);
 assert.equal(state.authenticatedEvidenceProvenByThisAssessor,false);
 assert.equal(state.productionDeployPerformed,false);
 assert.equal(state.payoutIntegrationPerformed,false);
 assert.ok(state.blockers.includes('real-auth-model-not-reviewed'));
 assert.ok(state.blockers.includes('actual-independent-backups-not-restored'));
});
test('R155 incompatible flags or mismatched exact-sha evidence fail closed individually',()=>{
 for(const key of ['repository','sourceRef','commitSha','checks','migrationChecksum',
  'restoredPgDumpChecksum','independentReviewerId','reviewerSeparateFromOperator',
  'authMigrationReviewed','realBackupsRestored','liveIdentityBridgeVerified',
  'stagingTlsAndHostPinVerified','productionRequested']){
  const v=key==='checks'?[]:key==='productionRequested'?true:null;
  assert.equal(assessR155Cutover({...syntheticBestCase,[key]:v}).assessment,'NO_GO',key);
 }
 assert.equal(assessR155Cutover({...syntheticBestCase,checks:[
  ...evidence().slice(0,-1),evidence()[0]
 ]}).assessment,'NO_GO');
 assert.equal(assessR155Cutover({...syntheticBestCase,checks:evidence().map((x,i)=>
  i===2?{...x,sha:'c'.repeat(40)}:x)}).assessment,'NO_GO');
 assert.equal(assessR155Cutover({...syntheticBestCase,checks:evidence().map((x,i)=>
  i===2?{...x,artifactSha256:'bad'}:x)}).assessment,'NO_GO');
});
test('R155 fabricated all-green inputs NEVER authorize production',()=>{
 const verdict=assessR155Cutover(syntheticBestCase);
 assert.equal(verdict.assessment,'ELIGIBLE_FOR_EXTERNAL_REVIEW_ONLY');
 assert.equal(verdict.evidenceIsCallerSupplied,true);
 assert.equal(verdict.authenticatedEvidenceProvenByThisAssessor,false);
 assert.equal(verdict.productionCutoverAuthorized,false);
 assert.equal(verdict.actualUserAccountsMigrated,false);
});
