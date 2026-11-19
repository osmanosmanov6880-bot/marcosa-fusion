/**
 * R174 monotonic/optimistic restore catalog on disposable PostgreSQL 17.
 * Records may only advance by one sequence, at an equal-or-later archive
 * timestamp, to prevent selecting a valid but older offsite escrow.
 * Both checkpoint and append-only event must commit or fail together.
 */
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R174 archive checkpoint: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function r174CheckpointSql({
 expectedSequence,sequence,commit,archiveSha256,
 escrowSha256,evidenceSha256,archivedAtMs
}={}){
 ok(Number.isSafeInteger(expectedSequence)&&expectedSequence>=0&&
  Number.isSafeInteger(sequence)&&sequence===expectedSequence+1&&
  Number.isSafeInteger(archivedAtMs)&&archivedAtMs>0&&
  H40.test(commit||'')&&
  [archiveSha256,escrowSha256,evidenceSha256].every(x=>H64.test(x||'')),
  'strict source hashes, archive sequence +1, and timestamp required');
 const vals=[commit,archiveSha256,escrowSha256,evidenceSha256]
  .map(x=>"'"+x+"'");
 const statement=expectedSequence===0?
  "INSERT INTO r174_ci.checkpoint(id,sequence,source_commit,archive_sha256,escrow_sha256,evidence_sha256,archived_at_ms) "+
  "VALUES (1,"+sequence+","+
   vals.join(",")+","+archivedAtMs+") ON CONFLICT DO NOTHING RETURNING sequence":
  "UPDATE r174_ci.checkpoint SET sequence="+sequence+
   ",source_commit="+vals[0]+",archive_sha256="+vals[1]+
   ",escrow_sha256="+vals[2]+",evidence_sha256="+vals[3]+
   ",archived_at_ms="+archivedAtMs+",updated_at=clock_timestamp() "+
   "WHERE id=1 AND sequence="+expectedSequence+
   " AND archived_at_ms<="+archivedAtMs+" RETURNING sequence";
 return [
  'BEGIN;',
  'SET LOCAL ROLE marcosa_r174_writer;',
  'WITH updated AS ('+statement+'),',
  'logged AS (INSERT INTO r174_ci.checkpoint_events(sequence,archive_sha256,evidence_sha256)',
  " SELECT sequence,"+vals[1]+","+vals[3]+" FROM updated RETURNING sequence)",
  "SELECT (SELECT count(*) FROM updated)::text||'|'||(SELECT count(*) FROM logged)::text;",
  'COMMIT;'
 ].join('\n');
}
export function createR174ArchiveCheckpoint({
 executeSql,clock=()=>Date.now()
}={}){
 ok(typeof executeSql==='function'&&typeof clock==='function',
  'isolated PostgreSQL SQL adapter required');
 async function advance(input){
  const statement=r174CheckpointSql(input);
  let value;
  try{value=await executeSql(statement);}
  catch{fail('PostgreSQL checkpoint atomic transaction rejected');}
  const lines=typeof value==='string'?
   value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   lines.every(x=>x!=='0|0'&&x!=='1|0'&&x!=='0|1'),
   'checkpoint CAS lost, stale archive or audit missing');
  const t=clock();
  ok(Number.isSafeInteger(t)&&t>0,'timestamp unavailable');
  return Object.freeze({
   sequence:input.sequence,archiveSha256:input.archiveSha256,
   escrowSha256:input.escrowSha256,commit:input.commit,
   evidenceSha256:input.evidenceSha256,archivedAtMs:input.archivedAtMs,
   monotonicCheckpointAccepted:true,auditCommittedAtomically:true,
   productionAuthorized:false
  });
 }
 return Object.freeze({advance});
}
