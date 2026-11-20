/** R192 SERIALIZABLE append-only decision ledger for disposable PG17 only. */
import {H40,H64,requireTrue} from '../r190/common.mjs';
const NO_GO='NO_GO_EXTERNAL_APPROVALS_AND_LIVE_STAGING_REQUIRED';
const q=x=>"'"+x+"'";
export function r192NativeHoldSql({
 sourceCommit,parentR191Commit,sourceBundleSha256,
 reviewEvidenceSha256,iamRiskEvidenceSha256,rotationEvidenceSha256,
 releaseEvidenceSha256,decision,sourceMode,productionAuthorized
}={}){
 requireTrue(H40.test(sourceCommit||'')&&H40.test(parentR191Commit||'')&&
  [sourceBundleSha256,reviewEvidenceSha256,iamRiskEvidenceSha256,
   rotationEvidenceSha256,releaseEvidenceSha256]
    .every(x=>H64.test(x||''))&&
  sourceMode==='CI_DISPOSABLE'&&decision===NO_GO&&
  productionAuthorized===false,
  'only bound synthetic source and NO-GO evidence may be written');
 const parts=[sourceCommit,parentR191Commit,sourceBundleSha256,
  reviewEvidenceSha256,iamRiskEvidenceSha256,
  rotationEvidenceSha256,releaseEvidenceSha256]
  .map(q).join(',');
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r192_writer;',
  'WITH ins AS (INSERT INTO r192_ci.release_holds(',
  'id,source_commit,parent_r191_commit,source_bundle_sha256,',
  'review_sha256,iam_risk_sha256,rotation_sha256,release_sha256,',
  'source_mode,decision) VALUES (1,'+parts+',',
  q(sourceMode)+','+q(NO_GO)+')',
  'ON CONFLICT DO NOTHING RETURNING id),',
  'audit AS (INSERT INTO r192_ci.release_audit(id,release_sha256,decision)',
  'SELECT id,'+q(releaseEvidenceSha256)+','+q(NO_GO)+' FROM ins RETURNING id)',
  "SELECT (SELECT count(*) FROM ins)::text||'|'||",
  '(SELECT count(*) FROM audit)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR192NativeLedger({executeSql}={}){
 requireTrue(typeof executeSql==='function','real disposable PostgreSQL executor mandatory');
 async function append(packet){
  let output;
  try{output=await executeSql(r192NativeHoldSql(packet));}
  catch{throw Error('R192: append-only PostgreSQL transaction refused');}
  const lines=typeof output==='string'?
   output.split(/\r?\n/).map(x=>x.trim()).filter(Boolean):[];
  requireTrue(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'replay or partial append/audit write detected');
  return Object.freeze({recorded:true,decision:NO_GO,
   productionAuthorized:false,realPilotAuthorized:false});
 }
 return Object.freeze({append});
}
