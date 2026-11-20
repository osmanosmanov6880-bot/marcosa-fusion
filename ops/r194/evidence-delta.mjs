/** Strictly compare two source-pinned R193 intake receipts.
 * PASS_CLAIM remains an untrusted claim; missing/withdrawn never implies GO.
 */
import {H40,H64,plain,requireTrue,verifyReceipt,sealReceipt} from '../r190/common.mjs';
import {R193_CONTROLS} from '../r193/evidence-intake.mjs';
const statuses=['UNCHANGED','ADDED','WITHDRAWN','HASH_CHANGED',
 'CLAIM_CHANGED','HASH_AND_CLAIM_CHANGED'];
function receipt(r,commit,bundleSha256){
 const x=verifyReceipt(r,'R193_INTAKE',commit,bundleSha256);
 requireTrue(Array.isArray(x.records)&&x.records.length<=6&&
  x.allClaimsUnverified===true&&x.externalArtifactBytesVerified===false&&
  ['CI_FIXTURE','OPERATOR_OBSERVED_UNVERIFIED'].includes(x.sourceMode),
  'R193 intake must remain unverified');
 const found=new Set();
 for(const e of x.records){
  requireTrue(plain(e)&&R193_CONTROLS.includes(e.control)&&!found.has(e.control)&&
   H64.test(e.artifactSha256||'')&&
   e.sourceCommit===commit&&
   e.authority===x.sourceMode&&
   ['PASS_CLAIM','FAIL_CLAIM','UNAVAILABLE'].includes(e.claim)&&
   Number.isSafeInteger(e.observedAtMs)&&
   Number.isSafeInteger(e.expiresAtMs)&&
   e.observedAtMs<=x.observedAtMs&&x.observedAtMs<=e.expiresAtMs,
   'invalid source-bound claim record');
  found.add(e.control);
 }
 return x;
}
export function compareR194Evidence({
 commit,bundleSha256,before,after,clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof clock==='function','source-pinned evidence history required');
 const a=receipt(before,commit,bundleSha256);
 const b=receipt(after,commit,bundleSha256);
 const now=clock();
 requireTrue(b.observedAtMs>a.observedAtMs&&
  now>=b.observedAtMs&&now<=b.expiresAtMs&&
  b.sourceMode===a.sourceMode,
  'stale, reordered or mixed-authority evidence history rejected');
 const ma=new Map(a.records.map(x=>[x.control,x]));
 const mb=new Map(b.records.map(x=>[x.control,x]));
 const changes=R193_CONTROLS.map(control=>{
  const prev=ma.get(control),next=mb.get(control);
  let state='UNCHANGED';
  if(!prev&&next)state='ADDED';
  else if(prev&&!next)state='WITHDRAWN';
  else if(prev&&next){
   const hashChanged=prev.artifactSha256!==next.artifactSha256;
   const claimChanged=prev.claim!==next.claim;
   state=hashChanged&&claimChanged?'HASH_AND_CLAIM_CHANGED':
    hashChanged?'HASH_CHANGED':claimChanged?'CLAIM_CHANGED':'UNCHANGED';
  }
  return {control,state,
   previousHash:prev?.artifactSha256||null,
   currentHash:next?.artifactSha256||null,
   previousClaim:prev?.claim||null,currentClaim:next?.claim||null,
   stillUnverified:true,releaseClearance:false};
 });
 requireTrue(changes.every(x=>statuses.includes(x.state)),
  'unsupported evidence transition');
 const changed=changes.filter(x=>x.state!=='UNCHANGED');
 return sealReceipt({schemaVersion:1,kind:'R194_EVIDENCE_DELTA',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  beforeSha256:a.evidenceSha256,afterSha256:b.evidenceSha256,
  observedAtMs:now,expiresAtMs:b.expiresAtMs,
  changes,changedCount:changed.length,
  withdrawnCount:changed.filter(x=>x.state==='WITHDRAWN').length,
  sourceMode:b.sourceMode,
  actualSourceArtifactBytesIndependentlyChecked:false,
  decision:'NO_GO_OPERATOR_CLAIMS_NOT_EXTERNALLY_VERIFIED',
  realPilotAuthorized:false,productionAuthorized:false});
}
