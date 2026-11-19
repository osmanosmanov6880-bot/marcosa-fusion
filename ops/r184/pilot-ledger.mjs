/**
 * R184 native PostgreSQL17 serializable append of NO-GO for synthetic pilot.
 * SELECT-only predecessor R183, source-bound 32 event window, separate audit.
 */
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R184 pilot ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=x=>"'"+x+"'";
export function r184PilotSql({sourceCommit,runId,sequence,nonce,
 r183EvidenceSha256,reviewHistoryEvidenceSha256,
 iamDenyEvidenceSha256,continuityEvidenceSha256,evidenceSha256,
 sourceAccountId,offsiteAccountId,
 intentionallyMissingEvents,measuredRestoreMs,
 sourceMode,decision,productionAuthorized}={}){
 ok(H40.test(sourceCommit||'')&&
  Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&
  [r183EvidenceSha256,reviewHistoryEvidenceSha256,
   iamDenyEvidenceSha256,continuityEvidenceSha256,evidenceSha256]
   .every(x=>H64.test(x||''))&&
  /^\d{12}$/.test(sourceAccountId||'')&&
  /^\d{12}$/.test(offsiteAccountId||'')&&
  sourceAccountId!==offsiteAccountId&&
  intentionallyMissingEvents===24&&
  Number.isSafeInteger(measuredRestoreMs)&&
  measuredRestoreMs>=1&&measuredRestoreMs<=180000&&
  sourceMode==='CI_SYNTHETIC'&&
  decision==='NO_GO_REAL_STAGING_EVIDENCE_PENDING'&&
  productionAuthorized===false,
  'only exactly source-bound synthetic R183 descendant NO-GO may be written');
 const values=[runId,sequence,q(nonce),q(sourceCommit),
  q(r183EvidenceSha256),q(reviewHistoryEvidenceSha256),
  q(iamDenyEvidenceSha256),q(continuityEvidenceSha256),
  q(evidenceSha256),q(sourceAccountId),q(offsiteAccountId),
  intentionallyMissingEvents,measuredRestoreMs,
  q('CI_SYNTHETIC'),q(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r184_writer;',
  'WITH predecessor AS (SELECT 1 AS ok',
  ' FROM r183_ci.pilot_holds h',
  ' JOIN r183_ci.pilot_audit a ON a.id=h.id',
  ' WHERE h.id=1 AND h.run_id='+runId,
  ' AND h.sequence='+sequence,
  ' AND h.nonce='+q(nonce),
  ' AND h.commit_sha='+q(sourceCommit),
  ' AND h.evidence_sha256='+q(r183EvidenceSha256),
  ' AND a.evidence_sha256=h.evidence_sha256',
  ' AND h.source_mode='+q('CI_SYNTHETIC'),
  ' AND h.decision='+q('NO_GO_REAL_PILOT_EVIDENCE_PENDING'),
  ' AND h.production_authorized=false',
  ' AND h.source_account_id='+q(sourceAccountId),
  ' AND h.offsite_account_id='+q(offsiteAccountId),
  ' AND (SELECT count(*) FROM r184_ci.synthetic_continuity_events e',
  ' WHERE e.commit_sha=h.commit_sha AND e.run_id=h.run_id)=32',
  ' AND (SELECT count(*) FROM r184_ci.synthetic_continuity_events e',
  ' WHERE e.commit_sha=h.commit_sha AND e.run_id=h.run_id',
  ' AND e.phase='+q('BASELINE')+')=8',
  ' AND (SELECT count(*) FROM r184_ci.synthetic_continuity_events e',
  ' WHERE e.commit_sha=h.commit_sha AND e.run_id=h.run_id',
  ' AND e.phase='+q('AFTER_SNAPSHOT')+')=24',
  '), inserted AS (INSERT INTO r184_ci.pilot_holds(',
  ' run_id,sequence,nonce,commit_sha,r183_evidence_sha256,',
  ' review_history_sha256,iam_deny_sha256,continuity_sha256,',
  ' evidence_sha256,source_account_id,offsite_account_id,',
  ' intentionally_missing_events,measured_restore_ms,source_mode,decision)',
  ' SELECT '+values.join(',')+' FROM predecessor',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audit AS (INSERT INTO r184_ci.pilot_audit(id,evidence_sha256,decision)',
  ' SELECT id,'+q(evidenceSha256)+','+q(decision),
  ' FROM inserted RETURNING id)',
  "SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR184PilotLedger({executeSql}={}){
 ok(typeof executeSql==='function','native real PG17 append-only executor required');
 async function record(packet){
  let raw;
  try{raw=await executeSql(r184PilotSql(packet));}
  catch{fail('atomic native PostgreSQL R184 hold rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'source mismatch, missing continuity, duplicate hold or lost audit');
  return Object.freeze({
   recorded:true,evidenceSha256:packet.evidenceSha256,
   decision:'NO_GO_REAL_STAGING_EVIDENCE_PENDING',
   realPilotAuthorized:false,productionAuthorized:false
  });
 }
 return Object.freeze({record});
}
