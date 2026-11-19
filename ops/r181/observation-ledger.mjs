/**
 * R181 append-only NO-GO observation linked to R180 durable hold.
 * This is an observation of provider/API response shape, never a credential,
 * identity, KMS policy or human attestation and never a release approval.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,
 H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R181 observation ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);},q=s=>"'"+s+"'";
export function r181ObservationSql({runId,sequence,nonce,sourceCommit,
 classificationSha256,quorumReceiptSha256,
 historyRootSha256,probeSha256,sourceAccountId,offsiteAccountId,
 githubEvidenceSha256,awsEvidenceSha256,evidenceSha256,
 sourceMode,decision,productionAuthorized}={}){
 ok(Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&H40.test(sourceCommit||'')&&
  [classificationSha256,quorumReceiptSha256,
   historyRootSha256,probeSha256,githubEvidenceSha256,
   awsEvidenceSha256,evidenceSha256].every(x=>H64.test(x||''))&&
  /^\d{12}$/.test(sourceAccountId||'')&&
  /^\d{12}$/.test(offsiteAccountId||'')&&
  sourceAccountId!==offsiteAccountId&&
  ['CI_SYNTHETIC','MANUAL_READONLY'].includes(sourceMode)&&
  decision==='NO_GO_PROVIDER_ATTESTATION_PENDING'&&
  productionAuthorized===false,
  'unverified/no-GO source-bound exact evidence is the only permitted write');
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r181_writer;',
  'WITH candidate AS (',
  ' SELECT 1 AS allowed FROM r180_ci.holds h',
  ' JOIN r180_ci.hold_audit a ON a.id=h.id',
  ' WHERE h.id=1 AND h.run_id='+runId,
  ' AND h.sequence='+sequence+' AND h.nonce='+q(nonce),
  ' AND h.commit_sha='+q(sourceCommit),
  ' AND h.classification_sha256='+q(classificationSha256),
  ' AND h.quorum_receipt_sha256='+q(quorumReceiptSha256),
  ' AND h.history_root_sha256='+q(historyRootSha256),
  ' AND h.decision='+q('NO_GO_EXTERNAL_EVIDENCE_PENDING'),
  ' AND a.classification_sha256=h.classification_sha256',
  ' AND a.quorum_receipt_sha256=h.quorum_receipt_sha256',
  ' AND h.production_authorized=false',
  '), inserted AS (',
  ' INSERT INTO r181_ci.observations(',
  ' run_id,sequence,nonce,commit_sha,classification_sha256,',
  ' quorum_receipt_sha256,history_root_sha256,probe_sha256,',
  ' source_account_id,offsite_account_id,github_evidence_sha256,',
  ' aws_evidence_sha256,evidence_sha256,source_mode,decision)',
  ' SELECT '+[runId,sequence,q(nonce),q(sourceCommit),
   q(classificationSha256),q(quorumReceiptSha256),
   q(historyRootSha256),q(probeSha256),
   q(sourceAccountId),q(offsiteAccountId),
   q(githubEvidenceSha256),q(awsEvidenceSha256),
   q(evidenceSha256),q(sourceMode),q(decision)].join(','),
  ' FROM candidate ON CONFLICT DO NOTHING RETURNING id',
  '), audit AS (',
  ' INSERT INTO r181_ci.observation_audit(id,evidence_sha256,decision)',
  ' SELECT id,'+q(evidenceSha256)+','+q(decision),
  ' FROM inserted RETURNING id',
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR181ObservationLedger({executeSql}={}){
 ok(typeof executeSql==='function','native PG17 append-only executor required');
 async function record(input){
  let raw;
  try{raw=await executeSql(r181ObservationSql(input));}
  catch{fail('native PostgreSQL staging observation transaction failed');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'duplicate, replay, source drift or missing PostgreSQL audit');
  return Object.freeze({recorded:true,evidenceSha256:input.evidenceSha256,
   decision:'NO_GO_PROVIDER_ATTESTATION_PENDING',
   productionAuthorized:false});
 }
 return Object.freeze({record});
}
