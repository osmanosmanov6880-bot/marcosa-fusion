/**
 * R171 transaction-atomic one-time PostgreSQL fence, no direct production DB.
 * Caller supplies one isolated SQL executor. Inputs are strictly hex/known ARN
 * strings before composing fixed SQL (no user SQL fragments). Both CTE
 * inserts occur under a single committed transaction and SET LOCAL ROLE.
 * Duplicate reservation is a hard failure even across fresh psql processes.
 */
const H32=/^[a-f0-9]{32}$/,H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const ARN=/^arn:aws:iam::[0-9]{12}:role\/marcosa-staging-backup-role$/;
const fail=m=>{throw Error('R171 PostgreSQL fence: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
export function r171BuildFenceSql({nonce,commit,archiveSha256,
 reviewerDigest,roleArn}={}){
 ok(H32.test(nonce||'')&&H40.test(commit||'')&&
  H64.test(archiveSha256||'')&&H64.test(reviewerDigest||'')&&
  ARN.test(roleArn||''),
  'only hex source, signed review, AWS staging role and nonce');
 const values=[nonce,commit,archiveSha256,reviewerDigest,roleArn]
  .map(s=>"'"+s+"'").join(',');
 return [
  'BEGIN;',
  'SET LOCAL ROLE marcosa_r171_writer;',
  'WITH reserved AS (',
  ' INSERT INTO r171_ci.fenced_runs(nonce,source_commit,archive_sha256,reviewer_digest,role_arn)',
  ' VALUES('+values+') ON CONFLICT(nonce) DO NOTHING RETURNING nonce',
  '), log AS (',
  ' INSERT INTO r171_ci.fenced_audit(nonce,digest)',
  " SELECT nonce,'"+reviewerDigest+"' FROM reserved RETURNING nonce",
  ') SELECT (SELECT count(*) FROM reserved)::text||\'|\'||',
  ' (SELECT count(*) FROM log)::text;',
  'COMMIT;'
 ].join('\n');
}
export function createR171PostgresFence({executeSql,clock=()=>Date.now()}={}){
 ok(typeof executeSql==='function'&&typeof clock==='function',
  'isolated PostgreSQL SQL executor required');
 async function consume(input){
  const statement=r171BuildFenceSql(input);
  let result;
  try{result=await executeSql(statement);}catch{fail('transaction rejected by PostgreSQL');}
  ok(typeof result==='string'&&result.length<1000,
   'bounded SQL transaction response required');
  const lines=result.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  // Some psql versions include command tags (BEGIN, SET, COMMIT) in output.
  const successful=lines.filter(x=>x==='1|1').length;
  const duplicate=lines.filter(x=>x==='0|0').length;
  ok(successful===1&&duplicate===0,
   'nonce collision, partial commit or ambiguous SQL output');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted clock required');
  return Object.freeze({nonce:input.nonce,
   commit:input.commit,archiveSha256:input.archiveSha256,
   reviewerDigest:input.reviewerDigest,roleArn:input.roleArn,
   durablePostgresFence:true,rehearsalLeaseRecorded:true,
   consumedExactlyOnce:true,syntheticPostgresOnly:true,
   createdAtMs:now,productionAuthorized:false});
 }
 return Object.freeze({consume});
}
