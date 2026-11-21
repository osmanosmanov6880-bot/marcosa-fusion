/**
 * R176: independent PG17 serializable per-archive one-use gate AFTER
 * R175 durable nonce. R175 now has UNIQUE(sequence) as the first barrier.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R176 recovery fence: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function r176AdmissionSql({nonce,sequence,anchorSha256,archiveSha256,
 checkpointSha256,commit}={}){
 ok(H32.test(nonce||'')&&Number.isSafeInteger(sequence)&&sequence>0&&
  H64.test(anchorSha256||'')&&H64.test(archiveSha256||'')&&
  H64.test(checkpointSha256||'')&&H40.test(commit||''),
  'strict R175 nonce, anchor, source and current R174 high-water required');
 const q=x=>"'"+x+"'";
 return [
  'BEGIN;',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  'SET LOCAL ROLE marcosa_r176_writer;',
  'WITH candidate AS (',
  ' SELECT l.nonce,l.sequence,l.anchor_sha256,l.archive_sha256,',
  ' c.evidence_sha256,l.commit_sha',
  ' FROM r175_ci.recovery_leases l',
  ' JOIN r174_ci.checkpoint c ON c.id=1 AND c.sequence=l.sequence',
  ' AND c.archive_sha256=l.archive_sha256 AND c.source_commit=l.commit_sha',
  ' WHERE l.nonce='+q(nonce)+' AND l.sequence='+sequence,
  ' AND l.anchor_sha256='+q(anchorSha256),
  ' AND l.archive_sha256='+q(archiveSha256),
  ' AND l.commit_sha='+q(commit),
  ' AND c.evidence_sha256='+q(checkpointSha256),
  ' AND l.production_authorized=false AND c.production_authorized=false',
  '), inserted AS (',
  ' INSERT INTO r176_ci.admissions(nonce,sequence,anchor_sha256,archive_sha256,checkpoint_sha256,commit_sha)',
  ' SELECT nonce,sequence,anchor_sha256,archive_sha256,evidence_sha256,commit_sha',
  ' FROM candidate ON CONFLICT DO NOTHING RETURNING nonce',
  '), audited AS (',
  ' INSERT INTO r176_ci.admission_audit(nonce,sequence)',
  ' SELECT i.nonce,'+sequence+' FROM inserted i RETURNING nonce',
  ") SELECT (SELECT count(*) FROM inserted)::text||'|'||",
  '(SELECT count(*) FROM audited)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR176RecoveryFence({executeSql}={}){
 ok(typeof executeSql==='function','independent PG17 SQL executor required');
 async function admit(input){
  let result;
  try{result=await executeSql(r176AdmissionSql(input));}
  catch{fail('atomic PostgreSQL admission rejected');}
  const lines=typeof result==='string'?result.split(/\r?\n/)
   .map(x=>x.trim()).filter(Boolean):[];
  ok(lines.filter(x=>x==='1|1').length===1&&
   !lines.some(x=>/^[01]\|[01]$/.test(x)&&x!=='1|1'),
   'stale checkpoint, reused sequence or missing R175 lease');
  return Object.freeze({admittedExactlyOnce:true,sequence:input.sequence,
   nonce:input.nonce,anchorSha256:input.anchorSha256,
   productionAuthorized:false});
 }
 return Object.freeze({admit});
}
export function createR176CompositeNonce({r175Nonce,r176Fence,checkpointSha256}={}){
 ok(r175Nonce&&typeof r175Nonce.consume==='function'&&
  r176Fence&&typeof r176Fence.admit==='function'&&
  H64.test(checkpointSha256||''),
  'two durable PG17 admission gates and evidence hash required');
 async function consume(input){
  const first=await r175Nonce.consume(input);
  ok(first?.consumedExactlyOnce===true&&first.nonce===input.nonce&&
   first.anchorSha256===input.anchorSha256&&
   first.productionAuthorized===false,
   'R175 first one-use nonce was not committed');
  const second=await r176Fence.admit({...input,checkpointSha256});
  ok(second?.admittedExactlyOnce===true&&second.nonce===input.nonce&&
   second.sequence===input.sequence&&second.productionAuthorized===false,
   'R176 second one-use archive fence was not committed');
  return Object.freeze({...first,sequenceFenceVerified:true,
   productionAuthorized:false});
 }
 return Object.freeze({consume});
}
