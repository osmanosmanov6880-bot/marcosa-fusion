/**
 * R183 one-time SERIALIZABLE native PG17 append-only NO-GO.
 * Reads immutable R182 + its audit, source R181 and TWO synthetic marker
 * rows. SQL never allows production GO, update, delete or pilot mutation.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,
 H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R183 pilot ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=x=>"'"+x+"'";
export function r183PilotSql({runId,sequence,nonce,sourceCommit,
 r182EvidenceSha256,boundaryEvidenceSha256,prReviewEvidenceSha256,
 deltaEvidenceSha256,evidenceSha256,
 baselineMarkerSha256,afterBackupMarkerSha256,
 sourceAccountId,offsiteAccountId,syntheticLostDeltaEvents,
 isolatedMeasuredRestoreMs,decision,sourceMode,productionAuthorized}={}){
 ok(Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&H40.test(sourceCommit||'')&&
  [r182EvidenceSha256,boundaryEvidenceSha256,
   prReviewEvidenceSha256,deltaEvidenceSha256,evidenceSha256,
   baselineMarkerSha256,afterBackupMarkerSha256].every(x=>H64.test(x||''))&&
  /^\d{12}$/.test(sourceAccountId||'')&&
  /^\d{12}$/.test(offsiteAccountId||'')&&
  sourceAccountId!==offsiteAccountId&&
  syntheticLostDeltaEvents===1&&
  Number.isSafeInteger(isolatedMeasuredRestoreMs)&&
  isolatedMeasuredRestoreMs>=1&&isolatedMeasuredRestoreMs<=180000&&
  sourceMode==='CI_SYNTHETIC'&&
  decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
  productionAuthorized===false,
  'only source-bound CI-synthetic read-only pilot NO-GO may be appended');
 const values=[runId,sequence,q(nonce),q(sourceCommit),
  q(r182EvidenceSha256),q(boundaryEvidenceSha256),
  q(prReviewEvidenceSha256),q(deltaEvidenceSha256),
  q(evidenceSha256),q(sourceAccountId),q(offsiteAccountId),
  syntheticLostDeltaEvents,isolatedMeasuredRestoreMs,
  q('CI_SYNTHETIC'),q(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r183_writer;',
  'WITH candidate AS (SELECT 1 AS allowed',
  ' FROM r182_ci.recovery_readiness r',
  ' JOIN r182_ci.readiness_audit a ON a.id=r.id',
  ' WHERE r.id=1 AND r.run_id='+runId,
  ' AND r.sequence='+sequence,
  ' AND r.nonce='+q(nonce),
  ' AND r.commit_sha='+q(sourceCommit),
  ' AND r.evidence_sha256='+q(r182EvidenceSha256),
  ' AND a.evidence_sha256=r.evidence_sha256',
  ' AND r.source_mode='+q('CI_SYNTHETIC'),
  ' AND r.decision='+q('NO_GO_INDEPENDENT_ATTESTATION_PENDING'),
  ' AND r.production_authorized=false',
  ' AND r.source_account_id='+q(sourceAccountId),
  ' AND r.offsite_account_id='+q(offsiteAccountId),
  ' AND EXISTS(SELECT 1 FROM r183_ci.synthetic_delta_markers m',
  ' WHERE m.ordinal=1 AND m.kind='+q('BASELINE'),
  ' AND m.marker_sha256='+q(baselineMarkerSha256),
  ' AND m.run_id='+runId+' AND m.commit_sha='+q(sourceCommit)+')',
  ' AND EXISTS(SELECT 1 FROM r183_ci.synthetic_delta_markers m',
  ' WHERE m.ordinal=2 AND m.kind='+q('POST_BACKUP'),
  ' AND m.marker_sha256='+q(afterBackupMarkerSha256),
  ' AND m.run_id='+runId+' AND m.commit_sha='+q(sourceCommit)+')',
  '), inserted AS (INSERT INTO r183_ci.pilot_holds(',
  ' run_id,sequence,nonce,commit_sha,r182_evidence_sha256,',
  ' boundary_evidence_sha256,pr_review_evidence_sha256,',
  ' delta_evidence_sha256,evidence_sha256,',
  ' source_account_id,offsite_account_id,synthetic_lost_delta_events,',
  ' isolated_restore_ms,source_mode,decision)',
  ' SELECT '+values.join(',')+' FROM candidate',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audit AS (INSERT INTO r183_ci.pilot_audit(id,evidence_sha256,decision)',
  ' SELECT id,'+q(evidenceSha256)+','+q(decision),
  ' FROM inserted RETURNING id)',
  "SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR183PilotLedger({executeSql}={}){
 ok(typeof executeSql==='function','disposable PostgreSQL17 executor required');
 async function record(p){
  let raw;
  try{raw=await executeSql(r183PilotSql(p));}
  catch{fail('one-time source-bound native PG17 pilot NO-GO rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'duplicate pilot attempt, missing marker or atomic audit');
  return Object.freeze({recorded:true,evidenceSha256:p.evidenceSha256,
   decision:'NO_GO_REAL_PILOT_EVIDENCE_PENDING',
   realPilotAuthorized:false,productionAuthorized:false});
 }
 return Object.freeze({record});
}
