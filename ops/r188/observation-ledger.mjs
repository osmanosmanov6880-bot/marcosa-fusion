/**
 * R188 SERIALIZABLE one-use exact-source native PG17 NO-GO.
 * Append-only hold and independent audit. No production GO branch.
 */
const fail=m=>{throw Error('R188 observation ledger: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const quote=x=>"'"+x+"'";
export function r188ObservationSql({runId,sequence,nonce,sourceCommit,
 r187EvidenceSha256,retentionEvidenceSha256,transcriptSha256,
 transcriptFileSha256,evidenceSha256,syntheticVerifiedSignatures,
 sourceRemainingRows,restoredRemainingRows,expiredRowsAbsent,
 nativeForceRlsVerified,quarantineClosed,sourceMode,
 decision,productionAuthorized}={}){
 ok(Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&H40.test(sourceCommit||'')&&
  [r187EvidenceSha256,retentionEvidenceSha256,
   transcriptSha256,transcriptFileSha256,evidenceSha256]
   .every(x=>H64.test(x||''))&&
  syntheticVerifiedSignatures===2&&sourceRemainingRows===8&&
  restoredRemainingRows===8&&expiredRowsAbsent===4&&
  nativeForceRlsVerified===true&&quarantineClosed===true&&
  sourceMode==='CI_SYNTHETIC'&&
  decision==='NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING'&&
  productionAuthorized===false,
  'only synthetic R187 descendant and exact no-go proof may be written');
 const values=[runId,sequence,quote(nonce),quote(sourceCommit),
  quote(r187EvidenceSha256),quote(retentionEvidenceSha256),
  quote(transcriptSha256),quote(transcriptFileSha256),
  quote(evidenceSha256),2,8,8,4,'true','true',
  quote('CI_SYNTHETIC'),quote(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r188_writer;',
  'WITH prior AS (SELECT 1 AS matched FROM r187_ci.observation_holds h',
  ' JOIN r187_ci.observation_audit a ON a.id=h.id',
  ' WHERE h.id=1 AND h.run_id='+runId,
  ' AND h.sequence='+sequence,
  ' AND h.nonce='+quote(nonce),
  ' AND h.source_commit='+quote(sourceCommit),
  ' AND h.evidence_sha256='+quote(r187EvidenceSha256),
  ' AND a.evidence_sha256=h.evidence_sha256',
  ' AND h.source_mode='+quote('CI_SYNTHETIC'),
  ' AND h.decision='+quote('NO_GO_REAL_STAGING_ATTESTATION_PENDING'),
  ' AND h.production_authorized=false',
  '), ins AS (INSERT INTO r188_ci.attested_holds(',
  ' run_id,sequence,nonce,commit_sha,r187_sha256,retention_sha256,',
  ' transcript_sha256,transcript_file_sha256,evidence_sha256,',
  ' synthetic_signatures,source_rows,restored_rows,expired_rows_absent,',
  ' native_rls_verified,quarantine_closed,source_mode,decision)',
  ' SELECT '+values.join(',')+' FROM prior',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audit AS (INSERT INTO r188_ci.attested_audit(id,evidence_sha256,decision)',
  ' SELECT id,'+quote(evidenceSha256)+','+quote(decision),
  ' FROM ins RETURNING id)',
  "SELECT (SELECT count(*) FROM ins)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR188ObservationLedger({executeSql}={}){
 ok(typeof executeSql==='function','real native PG17 executor required');
 async function record(packet){
  let raw;
  try{raw=await executeSql(r188ObservationSql(packet));}
  catch{fail('native PG17 source-bound atomic append rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'replayed, corrupted or missing atomic R188 hold/audit');
  return Object.freeze({recorded:true,evidenceSha256:packet.evidenceSha256,
   decision:'NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING',
   realPilotAuthorized:false,productionAuthorized:false});
 }
 return Object.freeze({record});
}
