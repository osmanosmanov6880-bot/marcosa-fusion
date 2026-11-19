/**
 * R186 single-use immutable native PG17 observation ledger. CI only.
 * No path for real staging, permission grants, production or deployment.
 */
const fail=m=>{throw Error('R186 observation ledger: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,H32=/^[a-f0-9]{32}$/;
const q=x=>"'"+x+"'";
export function r186ObservationSql({
 runId,sequence,nonce,sourceCommit,r185EvidenceSha256,
 githubEvidenceSha256,httpsEvidenceSha256,evidenceSha256,
 stagingHostname,githubPrCurrentHeadApprovalsObserved,
 githubEnvironmentReviewerRuleObserved,
 stagingHttpAllChecksObservedPassed,hardBlockingChecks,
 sourceMode,decision,productionAuthorized
}={}){
 ok(Number.isSafeInteger(runId)&&runId>=10000&&
  Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  H32.test(nonce||'')&&H40.test(sourceCommit||'')&&
  [r185EvidenceSha256,githubEvidenceSha256,
   httpsEvidenceSha256,evidenceSha256].every(x=>H64.test(x||''))&&
  typeof stagingHostname==='string'&&
  /^staging\.[a-z0-9.-]{4,170}$/.test(stagingHostname)&&
  Number.isSafeInteger(githubPrCurrentHeadApprovalsObserved)&&
  githubPrCurrentHeadApprovalsObserved>=0&&
  githubPrCurrentHeadApprovalsObserved<=400&&
  typeof githubEnvironmentReviewerRuleObserved==='boolean'&&
  typeof stagingHttpAllChecksObservedPassed==='boolean'&&
  hardBlockingChecks===5&&sourceMode==='CI_SYNTHETIC'&&
  decision==='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'&&
  productionAuthorized===false,
  'only source-bound CI-synthetic NO-GO evidence can be inserted');
 const values=[runId,sequence,q(nonce),q(sourceCommit),
  q(r185EvidenceSha256),q(githubEvidenceSha256),
  q(httpsEvidenceSha256),q(evidenceSha256),
  q(stagingHostname),githubPrCurrentHeadApprovalsObserved,
  String(githubEnvironmentReviewerRuleObserved),
  String(stagingHttpAllChecksObservedPassed),
  5,q('CI_SYNTHETIC'),q(decision)];
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r186_writer;',
  'WITH prior AS (SELECT 1 AS okay FROM r185_ci.readiness_holds h',
  ' JOIN r185_ci.readiness_audit a ON a.id=h.id',
  ' WHERE h.id=1 AND h.run_id='+runId,
  ' AND h.sequence='+sequence,
  ' AND h.nonce='+q(nonce),
  ' AND h.commit_sha='+q(sourceCommit),
  ' AND h.evidence_sha256='+q(r185EvidenceSha256),
  ' AND a.evidence_sha256=h.evidence_sha256',
  ' AND h.source_mode='+q('CI_SYNTHETIC'),
  ' AND h.decision='+q('NO_GO_STAGING_BLOCKERS_UNRESOLVED'),
  ' AND h.production_authorized=false',
  '), inserted AS (INSERT INTO r186_ci.staging_observation_holds(',
  ' run_id,sequence,nonce,commit_sha,r185_sha256,github_sha256,https_sha256,',
  ' evidence_sha256,staging_hostname,observed_pr_approvals,',
  ' environment_rule_observed,http_health_passed,hard_blocking_checks,',
  ' source_mode,decision)',
  ' SELECT '+values.join(',')+' FROM prior',
  ' ON CONFLICT DO NOTHING RETURNING id',
  '), audit AS (INSERT INTO r186_ci.staging_observation_audit(',
  ' id,evidence_sha256,decision)',
  ' SELECT id,'+q(evidenceSha256)+','+q(decision),
  ' FROM inserted RETURNING id)',
  "SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR186ObservationLedger({executeSql}={}){
 ok(typeof executeSql==='function','native PG17 executor required');
 async function record(packet){
  let raw;
  try{raw=await executeSql(r186ObservationSql(packet));}
  catch{fail('native one-use R186 source-bound append rejected');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'missing predecessor, duplicated hold or missing atomic audit');
  return Object.freeze({recorded:true,
   evidenceSha256:packet.evidenceSha256,
   decision:'NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING',
   realPilotAuthorized:false,productionAuthorized:false});
 }
 return Object.freeze({record});
}
