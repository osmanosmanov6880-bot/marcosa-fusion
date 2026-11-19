/**
 * SERIALIZABLE native PG17 read-only predecessor JOIN followed by atomic
 * append of simulated IAM/isolated restore observations. No GO path exists.
 */
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R182 readiness ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=x=>"'"+x+"'";
export function r182ReadinessSql({sourceCommit,runId,sequence,nonce,
 r181EvidenceSha256,r180ClassificationSha256,r180QuorumReceiptSha256,
 iamEvidenceSha256,recoveryDrillEvidenceSha256,
 evidenceSha256,sourceAccountId,offsiteAccountId,isolatedMeasuredRestoreMs,
 decision,productionAuthorized,scope}={}){
 ok(H40.test(sourceCommit||'')&&
  Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&
  [r181EvidenceSha256,r180ClassificationSha256,
   r180QuorumReceiptSha256,iamEvidenceSha256,
   recoveryDrillEvidenceSha256,evidenceSha256]
   .every(x=>H64.test(x||''))&&
  /^\d{12}$/.test(sourceAccountId||'')&&
  /^\d{12}$/.test(offsiteAccountId||'')&&
  sourceAccountId!==offsiteAccountId&&
  Number.isSafeInteger(isolatedMeasuredRestoreMs)&&
  isolatedMeasuredRestoreMs>=1&&isolatedMeasuredRestoreMs<=180000&&
  scope==='synthetic-provider-disposable-pg17-readiness'&&
  decision==='NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
  productionAuthorized===false,
  'only source-pinned synthetic NO-GO and bounded restore result may be written');
 const values=[runId,sequence,q(nonce),q(sourceCommit),
  q(r181EvidenceSha256),q(r180ClassificationSha256),
  q(r180QuorumReceiptSha256),q(iamEvidenceSha256),
  q(recoveryDrillEvidenceSha256),q(evidenceSha256),
  q(sourceAccountId),q(offsiteAccountId),isolatedMeasuredRestoreMs,
  q('CI_SYNTHETIC'),q(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r182_writer;',
  'WITH candidate AS (SELECT 1 AS allowed',
  ' FROM r181_ci.observations o',
  ' JOIN r181_ci.observation_audit a ON a.id=o.id',
  ' JOIN r180_ci.holds h ON h.id=o.id',
  ' WHERE o.id=1 AND o.run_id='+runId,
  ' AND o.sequence='+sequence,
  ' AND o.nonce='+q(nonce),
  ' AND o.commit_sha='+q(sourceCommit),
  ' AND o.evidence_sha256='+q(r181EvidenceSha256),
  ' AND o.decision='+q('NO_GO_PROVIDER_ATTESTATION_PENDING'),
  ' AND o.source_mode='+q('CI_SYNTHETIC'),
  ' AND o.source_account_id='+q(sourceAccountId),
  ' AND o.offsite_account_id='+q(offsiteAccountId),
  ' AND o.production_authorized=false',
  ' AND a.evidence_sha256=o.evidence_sha256',
  ' AND h.nonce=o.nonce AND h.sequence=o.sequence',
  ' AND h.commit_sha=o.commit_sha',
  ' AND h.classification_sha256='+q(r180ClassificationSha256),
  ' AND h.quorum_receipt_sha256='+q(r180QuorumReceiptSha256),
  ' AND h.decision='+q('NO_GO_EXTERNAL_EVIDENCE_PENDING'),
  ' AND h.production_authorized=false',
  '), inserted AS (INSERT INTO r182_ci.recovery_readiness(',
  ' run_id,sequence,nonce,commit_sha,r181_evidence_sha256,',
  ' r180_classification_sha256,r180_quorum_sha256,',
  ' iam_evidence_sha256,recovery_drill_sha256,evidence_sha256,',
  ' source_account_id,offsite_account_id,isolated_restore_ms,',
  ' source_mode,decision)',
  ' SELECT '+values.join(',')+' FROM candidate',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audit AS (INSERT INTO r182_ci.readiness_audit(id,evidence_sha256,decision)',
  ' SELECT id,'+q(evidenceSha256)+','+q(decision),
  ' FROM inserted RETURNING id)',
  "SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR182ReadinessLedger({executeSql}={}){
 ok(typeof executeSql==='function','native PostgreSQL17 SQL executor required');
 async function record(e){
  let raw;
  try{raw=await executeSql(r182ReadinessSql(e));}
  catch{fail('source-bound PG17 transaction denied');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'duplicate readiness, R181 drift or missing atomic audit');
  return Object.freeze({recorded:true,evidenceSha256:e.evidenceSha256,
   decision:'NO_GO_INDEPENDENT_ATTESTATION_PENDING',
   productionAuthorized:false});
 }
 return Object.freeze({record});
}
