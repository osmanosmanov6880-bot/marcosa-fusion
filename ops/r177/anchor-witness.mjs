/**
 * R177 history witnesses on native disposable PostgreSQL17.
 * Exact source hashes and predecessor must be verified by R176 signed
 * offsite chain before these metadata-only SQL writes.
 */
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 V=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R177 anchor witness: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const q=v=>"'"+v+"'";
export function r177AppendAnchorSql({sequence,sourceCommit,archiveSha256,
 checkpointSha256,anchorSha256,objectSha256,versionId,
 priorAnchorSha256}={}){
 ok(Number.isSafeInteger(sequence)&&sequence>=1&&sequence<=32&&
  H40.test(sourceCommit||'')&&
  [archiveSha256,checkpointSha256,anchorSha256,objectSha256,
   priorAnchorSha256].every(v=>H64.test(v||''))&&V.test(versionId||'')&&
  (sequence===1?priorAnchorSha256==='0'.repeat(64):
   priorAnchorSha256!=='0'.repeat(64)),
  'exact sequence, full SHA, version and predecessor required');
 const parent=sequence===1?'true':
  'EXISTS (SELECT 1 FROM r177_ci.anchors p WHERE p.sequence='+
   (sequence-1)+' AND p.anchor_sha256='+q(priorAnchorSha256)+')';
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r177_writer;',
  'WITH candidate AS (SELECT 1 AS admitted WHERE',
  ' EXISTS (SELECT 1 FROM r174_ci.checkpoint c WHERE c.id=1',
  ' AND c.sequence>='+sequence+' AND c.production_authorized=false',
  ' AND (c.sequence<>'+sequence+' OR (c.source_commit='+q(sourceCommit),
  ' AND c.archive_sha256='+q(archiveSha256),
  ' AND c.evidence_sha256='+q(checkpointSha256)+')))',
  ' AND EXISTS (SELECT 1 FROM r174_ci.checkpoint_events e',
  ' WHERE e.sequence='+sequence+' AND e.archive_sha256='+q(archiveSha256),
  ' AND e.evidence_sha256='+q(checkpointSha256)+')',
  ' AND '+parent,
  '), inserted AS (',
  ' INSERT INTO r177_ci.anchors(sequence,source_commit,archive_sha256,',
  ' checkpoint_sha256,anchor_sha256,object_sha256,version_id,prior_anchor_sha256)',
  ' SELECT '+sequence+','+[sourceCommit,archiveSha256,
   checkpointSha256,anchorSha256,objectSha256,versionId,
   priorAnchorSha256].map(q).join(','),
  ' FROM candidate ON CONFLICT DO NOTHING RETURNING sequence',
  '), audited AS (',
  ' INSERT INTO r177_ci.anchor_audit(sequence,anchor_sha256)',
  ' SELECT sequence,'+q(anchorSha256)+' FROM inserted RETURNING sequence',
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audited)::text;',
  'COMMIT;'
 ].join('\n');
}
export function r177FinalizeRootSql({sequence,rootSha256,
 latestObjectSha256,checkpointSha256}={}){
 ok(Number.isSafeInteger(sequence)&&sequence>=2&&sequence<=32&&
  [rootSha256,latestObjectSha256,checkpointSha256].every(x=>H64.test(x||'')),
  'exact current history root and checkpoint required');
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r177_writer;',
  'WITH candidate AS (SELECT 1 AS admitted WHERE',
  ' EXISTS (SELECT 1 FROM r174_ci.checkpoint c WHERE c.id=1',
  ' AND c.sequence='+sequence+' AND c.evidence_sha256='+q(checkpointSha256),
  ' AND c.production_authorized=false)',
  ' AND (SELECT count(*) FROM r177_ci.anchors)='+sequence,
  ' AND (SELECT count(*) FROM r177_ci.anchor_audit)='+sequence,
  ' AND EXISTS (SELECT 1 FROM r177_ci.anchors a WHERE a.sequence='+sequence,
  ' AND a.object_sha256='+q(latestObjectSha256),
  ' AND a.checkpoint_sha256='+q(checkpointSha256)+')',
  '), inserted AS (',
  ' INSERT INTO r177_ci.roots(sequence,root_sha256,',
  ' latest_object_sha256,checkpoint_sha256,anchor_count)',
  ' SELECT '+sequence+','+q(rootSha256)+','+
   q(latestObjectSha256)+','+q(checkpointSha256)+','+sequence,
  ' FROM candidate ON CONFLICT DO NOTHING RETURNING sequence',
  ') SELECT (SELECT count(*) FROM inserted)::text;',
  'COMMIT;'
 ].join('\n');
}
function accepted(value,marker){
 const lines=typeof value==='string'?value.split(/\r?\n/)
  .map(x=>x.trim()).filter(Boolean):[];
 ok(lines.filter(x=>x===marker).length===1&&
  !lines.some(x=>/^\d+(?:\|\d+)?$/.test(x)&&x!==marker),
  'replay, missing audit, R174 high-water mismatch or SQL refusal');
}
export function createR177AnchorWitness({executeSql}={}){
 ok(typeof executeSql==='function','trusted PostgreSQL17 executor required');
 async function append(input){
  let result;
  try{result=await executeSql(r177AppendAnchorSql(input));}
  catch{fail('native PostgreSQL anchor insert rejected');}
  accepted(result,'1|1');
  return Object.freeze({recorded:true,sequence:input.sequence,
   anchorSha256:input.anchorSha256,productionAuthorized:false});
 }
 async function finalize(input){
  let result;
  try{result=await executeSql(r177FinalizeRootSql(input));}
  catch{fail('native PostgreSQL history root rejected');}
  accepted(result,'1');
  return Object.freeze({finalized:true,sequence:input.sequence,
   rootSha256:input.rootSha256,productionAuthorized:false});
 }
 return Object.freeze({append,finalize});
}
