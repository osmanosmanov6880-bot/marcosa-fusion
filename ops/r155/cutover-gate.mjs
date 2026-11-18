/**
 * R155 production-cutover eligibility assessor. Pure offline logic: not a
 * deployment function, not a CI authority and not an authentication system.
 * Even a passing fixture means READY_FOR_INDEPENDENT_REVIEW, NOT GO.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SOURCE_REPOSITORY='osmanosmanov6880-bot/marcosa-fusion';
const checks=Object.freeze([
 'disposable-pg17-three-user-rls',
 'synthetic-identity-mapped-parity',
 'idempotent-pg17-replay',
 'pg17-dump-restore-and-rls',
 'http-sqlite-browser-regression',
 'signed-independent-security-review'
]);
const hex40=/^[a-f0-9]{40}$/,hex64=/^[a-f0-9]{64}$/;
export const R155_REQUIRED_CHECKS=checks;
export function assessR155Cutover({
 repository,sourceRef,commitSha,checks:evidence=[],migrationChecksum,
 restoredPgDumpChecksum,independentReviewerId,reviewerSeparateFromOperator=false,
 authMigrationReviewed=false,realBackupsRestored=false,
 liveIdentityBridgeVerified=false,stagingTlsAndHostPinVerified=false,
 productionRequested=false
}={}){
 const blockers=[];
 if(repository!==SOURCE_REPOSITORY)blockers.push('repository-mismatch');
 if(sourceRef!=='refs/heads/main')blockers.push('reviewed-main-only');
 if(typeof commitSha!=='string'||!hex40.test(commitSha))blockers.push('exact-commit-sha');
 if(!Array.isArray(evidence)||evidence.length!==checks.length||
  new Set(evidence.map(x=>x?.name)).size!==checks.length)blockers.push('nonduplicate-evidence-list');
 for(const name of checks){
  const matches=Array.isArray(evidence)?evidence.filter(x=>x?.name===name):[];
  if(matches.length!==1||matches[0].conclusion!=='success'||matches[0].sha!==commitSha||
   !hex64.test(matches[0].artifactSha256||''))
   blockers.push('verified-evidence:'+name);
 }
 if(!hex64.test(migrationChecksum||''))blockers.push('verified-migration-sha');
 if(!hex64.test(restoredPgDumpChecksum||''))blockers.push('verified-pg-restore-sha');
 if(typeof independentReviewerId!=='string'||independentReviewerId.length<6||
  reviewerSeparateFromOperator!==true)blockers.push('independent-reviewer');
 if(authMigrationReviewed!==true)blockers.push('real-auth-model-not-reviewed');
 if(realBackupsRestored!==true)blockers.push('actual-independent-backups-not-restored');
 if(liveIdentityBridgeVerified!==true)blockers.push('production-identity-bridge-absent');
 if(stagingTlsAndHostPinVerified!==true)blockers.push('staging-tls-host-attestation-absent');
 if(productionRequested!==false)blockers.push('unexpected-production-request');
 const contract=Object.freeze({
  contract:'MARCOSA-R155-CUTOVER-NO-GO-v1',
  assessment:blockers.length?'NO_GO':'ELIGIBLE_FOR_EXTERNAL_REVIEW_ONLY',
  blockers,
  evidenceIsCallerSupplied:true,
  authenticatedEvidenceProvenByThisAssessor:false,
  syntheticLabIsNotProductionProof:true,
  productionDeployPerformed:false,
  actualUserAccountsMigrated:false,
  payoutIntegrationPerformed:false,
  productionCutoverAuthorized:false
 });
 return contract;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=assessR155Cutover();
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.assessment!=='NO_GO')throw Error('Default cutover gate must be fail-closed');
}
