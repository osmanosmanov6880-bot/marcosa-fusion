/** Risk trend across two real-shaped R193 assessment snapshots.
 * A better status is only a reported improvement, never production clearance.
 */
import {H40,H64,requireTrue,verifyReceipt,sealReceipt} from '../r190/common.mjs';
import {R193_POLICY} from '../r193/assessment.mjs';
const risk={BLOCKED:3,MISSING:2,CLAIM_UNVERIFIED:1,OBSERVED_UNATTESTED:0};
export function compareR194Readiness({
 commit,bundleSha256,before,after,clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof clock==='function','source-bound risk comparison required');
 const a=verifyReceipt(before,'R193_ASSESSMENT',commit,bundleSha256);
 const b=verifyReceipt(after,'R193_ASSESSMENT',commit,bundleSha256);
 const now=clock();
 requireTrue(b.observedAtMs>a.observedAtMs&&
  now>=b.observedAtMs&&now<=b.expiresAtMs&&
  [a,b].every(s=>Array.isArray(s.controls)&&s.controls.length===8&&
   s.decision==='NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED'&&
   s.productionAuthorized===false&&
   s.controls.every((x,i)=>x.id===R193_POLICY[i].id&&
    Object.hasOwn(risk,x.status)&&x.allowedForRelease===false)),
  'incompatible, stale or unauthorized readiness history');
 const changes=R193_POLICY.map((p,i)=>{
  const x=a.controls[i],y=b.controls[i],delta=risk[y.status]-risk[x.status];
  return {id:p.id,owner:p.owner,
   previousStatus:x.status,currentStatus:y.status,
   status:'UNMODIFIED',
   delta,requiresExternalVerification:true,
   productionAuthorized:false};
 }).map(x=>({...x,status:x.delta>0?'DEGRADED':
  x.delta<0?'REPORTED_IMPROVEMENT':'UNMODIFIED'}));
 const degraded=changes.filter(x=>x.status==='DEGRADED');
 const improving=changes.filter(x=>x.status==='REPORTED_IMPROVEMENT');
 const blocked=b.controls.map(x=>x.id);
 return sealReceipt({schemaVersion:1,kind:'R194_RISK_TREND',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  beforeSha256:a.evidenceSha256,afterSha256:b.evidenceSha256,
  observedAtMs:now,expiresAtMs:b.expiresAtMs,
  changes,regressions:degraded.map(x=>x.id),
  reportedImprovements:improving.map(x=>x.id),
  stillRequireExternalApproval:blocked,
  decision:'NO_GO_TREND_IS_NOT_INDEPENDENT_APPROVAL',
  realPilotAuthorized:false,productionAuthorized:false});
}
