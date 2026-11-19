/**
 * R180 PostgreSQL17 SERIALIZABLE single NO-GO decision based on the real
 * immutable R178/R179 CI evidence. It does NOT verify cloud services or
 * people; those facts are explicitly unresolved and block production.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,
 H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R180 hold ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=s=>"'"+s+"'";
export function r180HoldSql({runId,sequence,nonce,sourceCommit,
 historyRootSha256,archiveSha256,restoredStateSha256,
 reviewEvidenceSha256,classificationSha256,
 quorumReceiptSha256,operatorPinSha256,auditorPinSha256,
 blockerCount,decision}={}){
 ok(Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&H40.test(sourceCommit||'')&&
  [historyRootSha256,archiveSha256,restoredStateSha256,
   reviewEvidenceSha256,classificationSha256,
   quorumReceiptSha256,operatorPinSha256,auditorPinSha256]
    .every(x=>H64.test(x||''))&&
  operatorPinSha256!==auditorPinSha256&&
  blockerCount===5&&decision==='NO_GO_EXTERNAL_EVIDENCE_PENDING',
  'exact prior immutable evidence, dual keys and five external blockers required');
 const vals=[runId,sequence,q(nonce),q(sourceCommit),
  q(historyRootSha256),q(archiveSha256),
  q(restoredStateSha256),q(reviewEvidenceSha256),
  q(classificationSha256),q(quorumReceiptSha256),
  q(operatorPinSha256),q(auditorPinSha256),blockerCount,
  q(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r180_writer;',
  'WITH candidate AS ( SELECT 1 AS allowed',
  ' FROM r179_ci.review_evidence r',
  ' JOIN r179_ci.review_audit a ON a.id=r.id',
  ' JOIN r178_ci.staging_evidence s ON s.id=r.id',
  ' WHERE r.id=1 AND r.run_id='+runId,
  ' AND r.sequence='+sequence,
  ' AND r.nonce='+q(nonce),
  ' AND r.commit_sha='+q(sourceCommit),
  ' AND r.history_root_sha256='+q(historyRootSha256),
  ' AND r.archive_sha256='+q(archiveSha256),
  ' AND r.restored_state_sha256='+q(restoredStateSha256),
  ' AND r.evidence_sha256='+q(reviewEvidenceSha256),
  ' AND a.evidence_sha256=r.evidence_sha256',
  ' AND r.decision='+q('CI_SIMULATED_REVIEW_ONLY'),
  ' AND r.production_authorized=false',
  ' AND s.commit_sha=r.commit_sha AND s.sequence=r.sequence',
  ' AND s.nonce=r.nonce AND s.root_sha256=r.history_root_sha256',
  ' AND s.production_authorized=false',
  '), inserted AS (',
  ' INSERT INTO r180_ci.holds(',
  ' run_id,sequence,nonce,commit_sha,history_root_sha256,',
  ' archive_sha256,restored_state_sha256,review_evidence_sha256,',
  ' classification_sha256,quorum_receipt_sha256,',
  ' operator_pin_sha256,auditor_pin_sha256,blocker_count,decision)',
  ' SELECT '+vals.join(',')+' FROM candidate',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audited AS (',
  ' INSERT INTO r180_ci.hold_audit(id,classification_sha256,',
  ' quorum_receipt_sha256,decision)',
  ' SELECT id,'+q(classificationSha256)+','+
   q(quorumReceiptSha256)+','+q(decision),
  ' FROM inserted RETURNING id',
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audited)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR180HoldLedger({executeSql}={}){
 ok(typeof executeSql==='function','trusted disposable PostgreSQL17 SQL executor required');
 async function record(payload){
  let raw;
  try{raw=await executeSql(r180HoldSql(payload));}
  catch{fail('native PG17 NO-GO hold transaction rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'replayed hold, R179 drift, or lost atomic PostgreSQL audit');
  return Object.freeze({recorded:true,
   decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING',
   classificationSha256:payload.classificationSha256,
   quorumReceiptSha256:payload.quorumReceiptSha256,
   productionAuthorized:false});
 }
 return Object.freeze({record});
}
