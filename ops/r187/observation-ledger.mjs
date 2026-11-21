/**
 * R187 native PG17 SERIALIZABLE + FORCE-RLS immutable NO-GO.
 * Requires exact R186 source hold and 8 retained + 0 expired test records.
 * Atomic audit, no replay, no privilege grant, no staging deployment.
 */
const fail=m=>{throw Error('R187 ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const q=x=>"'"+x+"'";
export function r187ObservationSql({
 runId,sequence,nonce,sourceCommit,r186EvidenceSha256,
 retentionEvidenceSha256,dualAttestationEvidenceSha256,
 tlsPinEvidenceSha256,evidenceSha256,syntheticExpiredRowsDeleted,
 syntheticActiveRowsRemaining,verifiedSyntheticSignatures,
 sourceMode,decision,productionAuthorized
}={}){
 ok(Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&H40.test(sourceCommit||'')&&
  [r186EvidenceSha256,retentionEvidenceSha256,
   dualAttestationEvidenceSha256,tlsPinEvidenceSha256,
   evidenceSha256].every(x=>H64.test(x||''))&&
  syntheticExpiredRowsDeleted===4&&
  syntheticActiveRowsRemaining===8&&
  verifiedSyntheticSignatures===2&&
  sourceMode==='CI_SYNTHETIC'&&
  decision==='NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
  productionAuthorized===false,
  'R187 only exact source-bound synthetic NO-GO may be recorded');
 const values=[runId,sequence,q(nonce),q(sourceCommit),
  q(r186EvidenceSha256),q(retentionEvidenceSha256),
  q(dualAttestationEvidenceSha256),q(tlsPinEvidenceSha256),
  q(evidenceSha256),4,8,2,q('CI_SYNTHETIC'),q(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r187_hold_writer;',
  'WITH prior AS (SELECT 1 AS allowed',
  ' FROM r186_ci.staging_observation_holds h',
  ' JOIN r186_ci.staging_observation_audit a ON a.id=h.id',
  ' WHERE h.id=1 AND h.run_id='+runId,
  ' AND h.sequence='+sequence,
  ' AND h.nonce='+q(nonce),
  ' AND h.commit_sha='+q(sourceCommit),
  ' AND h.evidence_sha256='+q(r186EvidenceSha256),
  ' AND a.evidence_sha256=h.evidence_sha256',
  ' AND h.source_mode='+q('CI_SYNTHETIC'),
  ' AND h.decision='+q('NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'),
  ' AND h.production_authorized=false',
  ' AND (SELECT count(*) FROM r187_ci.synthetic_retention',
  ' WHERE run_id=h.run_id AND source_commit=h.commit_sha)=8',
  ' AND (SELECT count(*) FROM r187_ci.synthetic_retention',
  ' WHERE run_id=h.run_id AND source_commit=h.commit_sha',
  ' AND expires_at<statement_timestamp())=0',
  '), written AS (INSERT INTO r187_ci.observation_holds(',
  ' run_id,sequence,nonce,source_commit,r186_evidence_sha256,',
  ' retention_sha256,dual_attestation_sha256,tls_pin_sha256,evidence_sha256,',
  ' records_deleted,records_retained,verified_signatures,',
  ' source_mode,decision)',
  ' SELECT '+values.join(',')+' FROM prior',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audit AS (INSERT INTO r187_ci.observation_audit(',
  ' id,evidence_sha256,decision)',
  ' SELECT id,'+q(evidenceSha256)+','+q(decision),
  ' FROM written RETURNING id)',
  "SELECT (SELECT count(*) FROM written)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR187ObservationLedger({executeSql}={}){
 ok(typeof executeSql==='function','native disposable PG17 executor required');
 async function record(packet){
  let raw;
  try{raw=await executeSql(r187ObservationSql(packet));}
  catch{fail('one-use source-bound PG17 atomic hold rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'missing R186 ancestor, expired retention, replay or incomplete audit');
  return Object.freeze({
   recorded:true,evidenceSha256:packet.evidenceSha256,
   decision:'NO_GO_REAL_STAGING_ATTESTATION_PENDING',
   realPilotAuthorized:false,productionAuthorized:false
  });
 }
 return Object.freeze({record});
}
