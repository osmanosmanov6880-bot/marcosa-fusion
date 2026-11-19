/**
 * R185 SERIALIZABLE source-bound append-only native PG17 NO-GO.
 * Atomic predecessor JOIN and audit receipt; rejects replays/GO attempts.
 */
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const fail=m=>{throw Error('R185 ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=x=>"'"+x+"'";
export function r185HoldSql({
 sourceCommit,runId,sequence,nonce,r184EvidenceSha256,
 intakeEvidenceSha256,rehearsalEvidenceSha256,
 safeEvidenceSha256,safeFileSha256,evidenceSha256,
 blockingCount,syntheticCanaryWindows,rollbackSimulationVerified,
 quarantineClosed,sourceMode,decision,productionAuthorized
}={}){
 ok(H40.test(sourceCommit||'')&&
  Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&
  [r184EvidenceSha256,intakeEvidenceSha256,rehearsalEvidenceSha256,
   safeEvidenceSha256,safeFileSha256,evidenceSha256].every(
    x=>H64.test(x||''))&&
  blockingCount===5&&syntheticCanaryWindows===4&&
  rollbackSimulationVerified===true&&quarantineClosed===true&&
  sourceMode==='CI_SYNTHETIC'&&
  decision==='NO_GO_STAGING_BLOCKERS_UNRESOLVED'&&
  productionAuthorized===false,
  'only exact source-bound R184 descendant NO-GO can be recorded');
 const values=[runId,sequence,q(nonce),q(sourceCommit),
  q(r184EvidenceSha256),q(intakeEvidenceSha256),
  q(rehearsalEvidenceSha256),q(safeEvidenceSha256),
  q(safeFileSha256),q(evidenceSha256),blockingCount,
  syntheticCanaryWindows,'true','true',q('CI_SYNTHETIC'),q(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r185_writer;',
  'WITH prior AS (SELECT 1 AS allowed FROM r184_ci.pilot_holds h',
  ' JOIN r184_ci.pilot_audit a ON a.id=h.id',
  ' WHERE h.id=1 AND h.run_id='+runId,
  ' AND h.sequence='+sequence,
  ' AND h.nonce='+q(nonce),
  ' AND h.commit_sha='+q(sourceCommit),
  ' AND h.evidence_sha256='+q(r184EvidenceSha256),
  ' AND a.evidence_sha256=h.evidence_sha256',
  ' AND h.source_mode='+q('CI_SYNTHETIC'),
  ' AND h.decision='+q('NO_GO_REAL_STAGING_EVIDENCE_PENDING'),
  ' AND h.production_authorized=false)',
  ' , ins AS (INSERT INTO r185_ci.readiness_holds(',
  ' run_id,sequence,nonce,commit_sha,r184_evidence_sha256,',
  ' intake_sha256,rehearsal_sha256,safe_evidence_sha256,safe_file_sha256,',
  ' evidence_sha256,blocking_count,synthetic_canary_windows,',
  ' rollback_simulation_verified,quarantine_closed,source_mode,decision)',
  ' SELECT '+values.join(',')+' FROM prior',
  ' ON CONFLICT DO NOTHING RETURNING id)',
  ' , audit AS (INSERT INTO r185_ci.readiness_audit(id,evidence_sha256,decision)',
  ' SELECT id,'+q(evidenceSha256)+','+q(decision),
  ' FROM ins RETURNING id)',
  "SELECT (SELECT count(*) FROM ins)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR185HoldLedger({executeSql}={}){
 ok(typeof executeSql==='function','real native PG17 SQL executor required');
 async function record(packet){
  let raw;
  try{raw=await executeSql(r185HoldSql(packet));}
  catch{fail('native PostgreSQL one-use NO-GO transaction rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'replayed or altered R185 immutable hold / audit');
  return Object.freeze({recorded:true,
   evidenceSha256:packet.evidenceSha256,
   decision:'NO_GO_STAGING_BLOCKERS_UNRESOLVED',
   realPilotAuthorized:false,productionAuthorized:false});
 }
 return Object.freeze({record});
}
