/** Evidence reconciliation and action plan. No production GO decision path. */
import {H40,H64,plain,requireTrue,verifyReceipt,sealReceipt} from '../r190/common.mjs';
import {R193_CONTROLS} from './evidence-intake.mjs';
const policy=Object.freeze([
 {id:'SOURCE_AND_CI',title:'Исходный код и CI',owner:'ENGINEERING',
  priority:1,action:'Зафиксировать GitHub HEAD, проверенный run и успешный полный CI'},
 {id:'PR_REVIEWS',title:'Три независимых согласования',owner:'GOVERNANCE',
  priority:1,action:'Получить актуальные reviews от Security, Operations и Privacy'},
 {id:'HUMAN_IDENTITY',title:'Подтверждение личности',owner:'GOVERNANCE',
  priority:1,action:'Независимо подтвердить личности владельцев ключей и GitHub аккаунтов'},
 {id:'GITHUB_ENVIRONMENT',title:'Защита GitHub Environment',owner:'DEVOPS',
  priority:1,action:'Проверить реальные правила environment, полномочия и историю approvals'},
 {id:'TLS_ORIGIN',title:'Подлинность staging TLS',owner:'SECURITY',
  priority:2,action:'Сравнить сертификат, DNS и отпечаток с независимым доверенным источником'},
 {id:'AWS_EFFECTIVE_RIGHTS',title:'Права AWS и ограничения',owner:'SECURITY',
  priority:1,action:'Независимо проверить IAM, SCP, KMS, resource policies и фактические разрешения'},
 {id:'STAGING_RESTORE',title:'Восстановление staging',owner:'OPERATIONS',
  priority:2,action:'Выполнить контролируемое восстановление с RPO/RTO и хеш-сверкой'},
 {id:'PRIVACY_LEGAL',title:'Правовое и privacy согласование',owner:'PRIVACY',
  priority:1,action:'Получить юридическое разрешение на реальный пилот и обработку данных'}
]);
export const R193_POLICY=policy;
export function assessR193Readiness({
 commit,bundleSha256,github,intake,clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  typeof clock==='function','source pinned readiness assessment required');
 const g=verifyReceipt(github,'R193_GITHUB',commit,bundleSha256);
 const e=verifyReceipt(intake,'R193_INTAKE',commit,bundleSha256);
 const now=clock();
 for(const r of [g,e])requireTrue(Number.isSafeInteger(now)&&
  Number.isSafeInteger(r.observedAtMs)&&Number.isSafeInteger(r.expiresAtMs)&&
  now>=r.observedAtMs&&now<=r.expiresAtMs,
  'source evidence expired');
 requireTrue(g.repository==='osmanosmanov6880-bot/marcosa-fusion'&&
  g.pullRequest===168&&g.prHeadMatches===true&&
  g.historyComplete===true&&
  Array.isArray(g.reviewers)&&g.reviewers.length===3&&
  e.allClaimsUnverified===true&&e.externalArtifactBytesVerified===false&&
  Array.isArray(e.records)&&e.records.length<=R193_CONTROLS.length,
  'invalid GitHub or operator intake assertions');
 const evidence=new Map(e.records.map(r=>[r.control,r]));
 requireTrue(evidence.size===e.records.length,'duplicate evidence control');
 for(const r of e.records){
  requireTrue(plain(r)&&R193_CONTROLS.includes(r.control)&&
   r.sourceCommit===commit&&H64.test(r.artifactSha256||'')&&
   ['PASS_CLAIM','FAIL_CLAIM','UNAVAILABLE'].includes(r.claim)&&
   ['CI_FIXTURE','OPERATOR_OBSERVED_UNVERIFIED'].includes(r.authority)&&
   r.authority===e.sourceMode&&r.observedAtMs<=now&&now<=r.expiresAtMs,
   'tampered operator claim fields');
 }
 const controls=policy.map(x=>{
  let result='MISSING',reason='NO_EVIDENCE';
  if(x.id==='SOURCE_AND_CI'){
   const success=g.runStatus==='completed'&&g.runConclusion==='success'&&
    g.commitSignatureProviderClaim===true;
   result=success?'OBSERVED_UNATTESTED':'BLOCKED';
   reason=success?'API_CI_SUCCESS_CLAIM':'CI_OR_SOURCE_NOT_VERIFIED';
  }else if(x.id==='PR_REVIEWS'){
   result=g.allThreeApprovalsObserved===true?'OBSERVED_UNATTESTED':'BLOCKED';
   reason=result==='BLOCKED'?'PR_REVIEW_QUORUM_MISSING':'GITHUB_REVIEW_CLAIM_ONLY';
  }else{
   const r=evidence.get(x.id);
   if(r){result=r.claim==='FAIL_CLAIM'?'BLOCKED':r.claim==='PASS_CLAIM'?
    'CLAIM_UNVERIFIED':'MISSING';
    reason=r.claim==='FAIL_CLAIM'?'OPERATOR_REPORTED_FAILURE':
     r.claim==='PASS_CLAIM'?'NO_EXTERNAL_ATTESTATION':'NO_USABLE_CLAIM';}
  }
  return {...x,status:result,reason,
   artifactSha256:evidence.get(x.id)?.artifactSha256||null,
   allowedForRelease:false};
 });
 const tally={
  blocked:controls.filter(x=>x.status==='BLOCKED').length,
  missing:controls.filter(x=>x.status==='MISSING').length,
  claims:controls.filter(x=>x.status==='CLAIM_UNVERIFIED').length,
  observed:controls.filter(x=>x.status==='OBSERVED_UNATTESTED').length
 };
 const actions=controls.filter(x=>x.status!=='OBSERVED_UNATTESTED').sort(
  (a,b)=>a.priority-b.priority||a.title.localeCompare(b.title,'ru'));
 const blockers=controls.map(x=>x.id);
 requireTrue(blockers.length===8,'policy may not silently skip required control');
 return sealReceipt({schemaVersion:1,kind:'R193_ASSESSMENT',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  observedAtMs:now,expiresAtMs:Math.min(g.expiresAtMs,e.expiresAtMs),
  githubEvidenceSha256:g.evidenceSha256,
  intakeEvidenceSha256:e.evidenceSha256,
  controls,actionQueue:actions.map(x=>({
   id:x.id,owner:x.owner,priority:x.priority,action:x.action})),
  tally,blockers,
  decision:'NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED',
  pilotEligible:false,deployAllowed:false,
  realPilotAuthorized:false,productionAuthorized:false});
}
