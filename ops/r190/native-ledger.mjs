/** Native PostgreSQL 17, SERIALIZABLE, one-use immutable synthetic NO-GO. */
import {H40,H64,requireTrue} from './common.mjs';
const quote=x=>"'"+x+"'";
export function r190NativeHoldSql({
 sourceCommit,r189Commit,bundleSha256,githubEvidenceSha256,
 signaturesEvidenceSha256,tlsEvidenceSha256,decision,
 productionAuthorized,sourceMode
}={}){
 requireTrue(H40.test(sourceCommit||'')&&H40.test(r189Commit||'')&&
  [bundleSha256,githubEvidenceSha256,signaturesEvidenceSha256,
   tlsEvidenceSha256].every(x=>H64.test(x||''))&&
  decision==='NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING'&&
  sourceMode==='CI_SYNTHETIC'&&productionAuthorized===false,
  'only exact source-bound synthetic NO-GO can enter native ledger');
 const values=[sourceCommit,r189Commit,bundleSha256,
  githubEvidenceSha256,signaturesEvidenceSha256,tlsEvidenceSha256]
  .map(quote).join(',');
 return ['BEGIN;','SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r190_writer;',
  'WITH ins AS (INSERT INTO r190_ci.immutable_hold(',
  ' id,source_commit,r189_commit,bundle_sha256,github_sha256,',
  ' signature_sha256,tls_sha256,source_mode,decision)',
  " VALUES (1,"+values+",'CI_SYNTHETIC',"+
    quote('NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING')+")",
  ' ON CONFLICT DO NOTHING RETURNING id),',
  ' audit AS (INSERT INTO r190_ci.immutable_audit(id,source_commit,decision)',
  ' SELECT id,'+quote(sourceCommit)+','+
   quote('NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING')+
   ' FROM ins RETURNING id)',
  " SELECT (SELECT count(*) FROM ins)::text||'|'||",
  ' (SELECT count(*) FROM audit)::text;',
  'COMMIT;'].join('\n');
}
export function createR190NativeLedger({executeSql}={}){
 requireTrue(typeof executeSql==='function','native PostgreSQL adapter required');
 async function record(packet){
  let raw;
  try{raw=await executeSql(r190NativeHoldSql(packet));}
  catch{throw Error('R190: immutable NO-GO native PostgreSQL rejected transaction');}
  const lines=typeof raw==='string'?raw.split(/\r?\n/).map(x=>x.trim()):[];
  requireTrue(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'duplicate or partial native hold/audit rejected');
  return Object.freeze({recorded:true,decision:'NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING',
   realPilotAuthorized:false,productionAuthorized:false});
 }
 return Object.freeze({record});
}
