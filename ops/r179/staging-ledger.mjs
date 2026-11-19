/**
 * R179 SERIALIZABLE PostgreSQL17 one-time append of review evidence
 * conditioned on R178 native stage + R177 final restored outcome.
 * This records a SIMULATED staging review, never real production consent.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,
 H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R179 staging ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=s=>"'"+s+"'";
export function r179ReviewEvidenceSql({runId,actorId,sequence,nonce,
 commit,historyRootSha256,archiveSha256,restoredStateSha256,
 probeSha256,sourceAccountId,offsiteAccountId,r178EvidenceSha256,
 githubEvidenceSha256,replicationEvidenceSha256,
 evidenceSha256,decision}={}){
 ok(Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(actorId)&&actorId>0&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&H40.test(commit||'')&&
  [historyRootSha256,archiveSha256,restoredStateSha256,probeSha256,
   r178EvidenceSha256,githubEvidenceSha256,
   replicationEvidenceSha256,evidenceSha256]
   .every(x=>H64.test(x||''))&&
  /^\d{12}$/.test(sourceAccountId||'')&&
  /^\d{12}$/.test(offsiteAccountId||'')&&
  sourceAccountId!==offsiteAccountId&&
  decision==='CI_SIMULATED_REVIEW_ONLY',
  'exact manual run, immutable R178 witness and no-production decision required');
 const values=[runId,actorId,sequence,q(nonce),q(commit),
  q(historyRootSha256),q(archiveSha256),
  q(restoredStateSha256),q(probeSha256),
  q(sourceAccountId),q(offsiteAccountId),
  q(r178EvidenceSha256),q(githubEvidenceSha256),
  q(replicationEvidenceSha256),q(evidenceSha256)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r179_writer;',
  'WITH candidate AS (SELECT 1 AS accepted',
  ' FROM r178_ci.staging_evidence e',
  ' JOIN r178_ci.staging_audit a ON a.id=e.id',
  ' JOIN r177_ci.outcomes o ON o.nonce=e.nonce',
  ' WHERE e.id=1 AND e.sequence='+sequence,
  ' AND e.nonce='+q(nonce)+' AND e.commit_sha='+q(commit),
  ' AND e.root_sha256='+q(historyRootSha256),
  ' AND e.archive_sha256='+q(archiveSha256),
  ' AND e.restored_state_sha256='+q(restoredStateSha256),
  ' AND e.probe_sha256='+q(probeSha256),
  ' AND e.source_account_id='+q(sourceAccountId),
  ' AND e.offsite_account_id='+q(offsiteAccountId),
  ' AND e.evidence_sha256='+q(r178EvidenceSha256),
  ' AND a.evidence_sha256=e.evidence_sha256',
  ' AND o.sequence=e.sequence AND o.root_sha256=e.root_sha256',
  ' AND o.restored_state_sha256=e.restored_state_sha256',
  ' AND o.production_authorized=false AND e.production_authorized=false',
  '), inserted AS (',
  ' INSERT INTO r179_ci.review_evidence(',
  ' run_id,actor_id,sequence,nonce,commit_sha,',
  ' history_root_sha256,archive_sha256,restored_state_sha256,',
  ' probe_sha256,source_account_id,offsite_account_id,',
  ' r178_evidence_sha256,github_evidence_sha256,',
  ' replica_evidence_sha256,evidence_sha256)',
  ' SELECT '+values.join(',')+' FROM candidate',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audited AS (',
  ' INSERT INTO r179_ci.review_audit(id,evidence_sha256)',
  ' SELECT id,'+q(evidenceSha256)+' FROM inserted RETURNING id',
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audited)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR179StagingLedger({executeSql}={}){
 ok(typeof executeSql==='function','native PG17 separate SQL executor required');
 async function record(input){
  let raw;
  try{raw=await executeSql(r179ReviewEvidenceSql(input));}
  catch{fail('native source-bound staging evidence transaction rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'duplicate review, historical rollback or missing independent audit');
  return Object.freeze({recorded:true,evidenceSha256:input.evidenceSha256,
   decision:'CI_SIMULATED_REVIEW_ONLY',productionAuthorized:false});
 }
 return Object.freeze({record});
}
