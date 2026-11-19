/**
 * R178 durable append-only native PostgreSQL17 evidence:
 * joins current R174 high-water, immutable R177 restore root and outcome.
 * Identity/probe evidence is declarative, not real AWS authentication;
 * native write can never authorize production.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,
 H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R178 staging ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=x=>"'"+x+"'";
export function r178StagingEvidenceSql({sequence,commit,nonce,
 historyRootSha256,archiveSha256,restoredStateSha256,
 probeSha256,sourceAccountId,offsiteAccountId,
 identityEvidenceSha256,iamPlanSha256,replicaEvidenceSha256,
 evidenceSha256,decision}={}){
 ok(Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H40.test(commit||'')&&H32.test(nonce||'')&&
  [historyRootSha256,archiveSha256,restoredStateSha256,probeSha256,
   identityEvidenceSha256,iamPlanSha256,replicaEvidenceSha256,
   evidenceSha256].every(x=>H64.test(x||''))&&
  /^\d{12}$/.test(sourceAccountId||'')&&
  /^\d{12}$/.test(offsiteAccountId||'')&&
  sourceAccountId!==offsiteAccountId&&
  decision==='CI_SIMULATION_COMPLETE',
  'full exact source, replica probe, review and simulated decision required');
 const args=[sequence,q(nonce),q(commit),q(historyRootSha256),
  q(archiveSha256),q(probeSha256),q(restoredStateSha256),
  q(sourceAccountId),q(offsiteAccountId),
  q(identityEvidenceSha256),q(iamPlanSha256),
  q(replicaEvidenceSha256),q(evidenceSha256)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r178_writer;',
  'WITH candidate AS (',
  ' SELECT 1 AS admitted FROM r174_ci.checkpoint c',
  ' JOIN r177_ci.roots r ON r.sequence=c.sequence',
  ' JOIN r177_ci.outcomes o ON o.sequence=c.sequence',
  ' WHERE c.id=1 AND c.sequence='+sequence,
  ' AND c.source_commit='+q(commit),
  ' AND c.archive_sha256='+q(archiveSha256),
  ' AND r.root_sha256='+q(historyRootSha256),
  ' AND r.checkpoint_sha256=c.evidence_sha256',
  ' AND r.production_authorized=false',
  ' AND o.nonce='+q(nonce),
  ' AND o.root_sha256='+q(historyRootSha256),
  ' AND o.restored_state_sha256='+q(restoredStateSha256),
  ' AND o.production_authorized=false',
  ' AND c.production_authorized=false',
  '), inserted AS (',
  ' INSERT INTO r178_ci.staging_evidence(',
  ' sequence,nonce,commit_sha,root_sha256,archive_sha256,',
  ' probe_sha256,restored_state_sha256,source_account_id,',
  ' offsite_account_id,identity_sha256,iam_plan_sha256,',
  ' replica_sha256,evidence_sha256)',
  ' SELECT '+args.join(',')+' FROM candidate',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audited AS (',
  ' INSERT INTO r178_ci.staging_audit(id,evidence_sha256)',
  ' SELECT id,'+q(evidenceSha256)+' FROM inserted RETURNING id',
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audited)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR178StagingLedger({executeSql}={}){
 ok(typeof executeSql==='function','isolated real PostgreSQL17 executor required');
 async function record(input){
  let out;
  try{out=await executeSql(r178StagingEvidenceSql(input));}
  catch{fail('atomic native staging evidence transaction rejected');}
  const lines=typeof out==='string'?out.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'stale source, replayed evidence or missing immutable audit');
  return Object.freeze({recorded:true,evidenceSha256:input.evidenceSha256,
   sequence:input.sequence,productionAuthorized:false});
 }
 return Object.freeze({record});
}
