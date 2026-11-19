/**
 * R177: append one completed native restore outcome AFTER independent
 * restored-database readback. SQL ties exact R174 tip, R176 nonce,
 * R177 signed-history root and latest immutable S3 object.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,
 H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R177 restore outcome: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=x=>"'"+x+"'";
export function r177RecordOutcomeSql({nonce,sequence,rootSha256,
 restoredStateSha256,archiveSha256,checkpointSha256,
 objectSha256,sourceCommit}={}){
 ok(H32.test(nonce||'')&&Number.isSafeInteger(sequence)&&
  sequence>=2&&sequence<=32&&H40.test(sourceCommit||'')&&
  [rootSha256,restoredStateSha256,archiveSha256,
   checkpointSha256,objectSha256].every(x=>H64.test(x||'')),
  'source, nonce, restored-state and historical root exact SHA required');
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r177_writer;',
  'WITH candidate AS (',
  ' SELECT a.nonce,a.sequence FROM r176_ci.admissions a',
  ' JOIN r177_ci.roots r ON r.sequence=a.sequence',
  ' JOIN r177_ci.anchors w ON w.sequence=a.sequence',
  ' JOIN r174_ci.checkpoint c ON c.id=1 AND c.sequence=a.sequence',
  ' WHERE a.nonce='+q(nonce)+' AND a.sequence='+sequence,
  ' AND a.anchor_sha256='+q(objectSha256),
  ' AND a.archive_sha256='+q(archiveSha256),
  ' AND a.checkpoint_sha256='+q(checkpointSha256),
  ' AND a.commit_sha='+q(sourceCommit),
  ' AND a.production_authorized=false',
  ' AND r.root_sha256='+q(rootSha256),
  ' AND r.latest_object_sha256='+q(objectSha256),
  ' AND r.checkpoint_sha256='+q(checkpointSha256),
  ' AND r.anchor_count='+sequence,
  ' AND r.production_authorized=false',
  ' AND w.object_sha256='+q(objectSha256),
  ' AND w.checkpoint_sha256='+q(checkpointSha256),
  ' AND c.source_commit='+q(sourceCommit),
  ' AND c.archive_sha256='+q(archiveSha256),
  ' AND c.evidence_sha256='+q(checkpointSha256),
  ' AND c.production_authorized=false',
  '), inserted AS (',
  ' INSERT INTO r177_ci.outcomes(nonce,sequence,root_sha256,restored_state_sha256)',
  ' SELECT nonce,sequence,'+q(rootSha256)+','+
   q(restoredStateSha256)+' FROM candidate',
  ' ON CONFLICT DO NOTHING RETURNING nonce,sequence',
  '), audited AS (',
  ' INSERT INTO r177_ci.outcome_audit(nonce,sequence,restored_state_sha256)',
  ' SELECT nonce,sequence,'+q(restoredStateSha256),
  ' FROM inserted RETURNING nonce',
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audited)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR177RestoreOutcomeStore({executeSql}={}){
 ok(typeof executeSql==='function','source PostgreSQL17 append-only executor required');
 async function record(input){
  let result;
  try{result=await executeSql(r177RecordOutcomeSql(input));}
  catch{fail('native PostgreSQL restored outcome audit rejected');}
  const lines=typeof result==='string'?result.split(/\r?\n/)
   .map(s=>s.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'duplicate, stale checkpoint, missing root, absent PG17 nonce or audit');
  return Object.freeze({recorded:true,nonce:input.nonce,
   sequence:input.sequence,rootSha256:input.rootSha256,
   restoredStateSha256:input.restoredStateSha256,
   productionAuthorized:false});
 }
 return Object.freeze({record});
}
