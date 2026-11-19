/**
 * R175 durable PostgreSQL 17 one-use restoration admission.
 * SQL reads the high-water checkpoint in the SAME transaction, acquiring
 * a shared lock to prevent R174 concurrent CAS while the fence is issued.
 * A second process using the same nonce returns 0|0 and is denied.
 * No privileges for UPDATE or DELETE of the audit or nonce tables.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R175 recovery nonce: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
export function r175RecoveryNonceSql({nonce,sequence,anchorSha256,
 archiveSha256,commit}={}){
 ok(H32.test(nonce||'')&&Number.isSafeInteger(sequence)&&sequence>0&&
  H64.test(anchorSha256||'')&&H64.test(archiveSha256||'')&&
  H40.test(commit||''),'strict SHA and sequence required');
 const n="'"+nonce+"'",anchor="'"+anchorSha256+"'",archive="'"+
  archiveSha256+"'",sha="'"+commit+"'";
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r175_writer;',
  "WITH current_checkpoint AS (",
  " SELECT sequence,archive_sha256,source_commit",
  " FROM r174_ci.checkpoint WHERE id=1",
  " FOR SHARE",
  "), inserted AS (",
  " INSERT INTO r175_ci.recovery_leases(nonce,sequence,anchor_sha256,archive_sha256,commit_sha)",
  " SELECT "+n+","+sequence+","+anchor+","+archive+","+sha,
  " FROM current_checkpoint WHERE sequence="+sequence+
   " AND archive_sha256="+archive+" AND source_commit="+sha,
  " ON CONFLICT DO NOTHING RETURNING nonce",
  "), audited AS (",
  " INSERT INTO r175_ci.recovery_audit(nonce,anchor_sha256,sequence)",
  " SELECT nonce,"+anchor+","+sequence+" FROM inserted RETURNING nonce",
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  "(SELECT count(*) FROM audited)::text;",
  'COMMIT;'
 ].join('\n');
}
export function createR175RecoveryNonce({executeSql}={}){
 ok(typeof executeSql==='function','PG17 SQL session required');
 async function consume(input){
  let value;
  try{value=await executeSql(r175RecoveryNonceSql(input));}
  catch{fail('atomic PostgreSQL lease rejected');}
  const lines=typeof value==='string'?value.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'stale checkpoint, reused nonce or audit failure');
  return Object.freeze({nonce:input.nonce,sequence:input.sequence,
   anchorSha256:input.anchorSha256,consumedExactlyOnce:true,
   productionAuthorized:false});
 }
 return Object.freeze({consume});
}
