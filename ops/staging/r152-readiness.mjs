/**
 * R152 staging preflight is a pure NO-DEPLOY evaluation. It cannot authenticate
 * CI claims or contact servers. External evidence is checked elsewhere.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateStagingDispatch,STAGING_REPO} from '../staging-deploy-contract.mjs';
export const REQUIRED_R152_CHECKS=Object.freeze(['social-http','finance-ledger','creator-browser','sqlite-restore']);
const sha=/^[0-9a-f]{40}$/,hex=/^[0-9a-f]{64}$/;
export function assessR152Staging({
 repository,ref,commitSha,checks=[],manifestSha256='',hostPinVerified=false,
 independentReview=false,httpsReadbackVerified=false,productionRequested=false
}={}){
 const blockers=[];
 if(repository!==STAGING_REPO)blockers.push('repository');
 if(ref!=='refs/heads/main')blockers.push('reviewed-main-ref');
 if(typeof commitSha!=='string'||!sha.test(commitSha))blockers.push('exact-main-sha');
 if(!Array.isArray(checks)||checks.length!==REQUIRED_R152_CHECKS.length||
  new Set(checks.map(x=>x?.name)).size!==REQUIRED_R152_CHECKS.length)blockers.push('check-set');
 for(const name of REQUIRED_R152_CHECKS){
  const matches=Array.isArray(checks)?checks.filter(x=>x?.name===name):[];
  if(matches.length!==1||matches[0].conclusion!=='success'||matches[0].headSha!==commitSha)
   blockers.push('verified-check:'+name);
 }
 if(typeof manifestSha256!=='string'||!hex.test(manifestSha256))blockers.push('verified-artifact-sha256');
 if(hostPinVerified!==true)blockers.push('independent-ssh-host-pin');
 if(independentReview!==true)blockers.push('independent-staging-reviewer');
 if(httpsReadbackVerified!==true)blockers.push('external-https-readback');
 if(productionRequested!==false)blockers.push('production-request-not-allowed');
 if(blockers.length===0)try{
  validateStagingDispatch({repository,eventName:'push',ref,sha:commitSha,
   confirmation:undefined,environment:'marcosa-staging'});
 }catch{blockers.push('staging-release-contract');}
 return{contract:'MARCOSA-R152-PREFLIGHT-v1',
  decision:blockers.length?'NO_GO':'READY_FOR_SEPARATE_STAGING_RELEASE_REVIEW',
  blockers,sourceSha:typeof commitSha==='string'&&sha.test(commitSha)?commitSha:null,
  evidenceIsSelfReported:true,independentEvidenceNotAuthenticatedByThisTool:true,
  stagingDeploymentPerformed:false,productionDeploymentPerformed:false,
  commercialProductionAuthorized:false,actualPayoutAuthorized:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=assessR152Staging({});
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
 if(output.decision!=='NO_GO')throw Error('Default preflight must remain NO_GO');
}
