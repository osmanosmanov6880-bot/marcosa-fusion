/**
 * R187: disposable synthetic retention / data-minimization exercise.
 * Exactly 4 expired and 8 retained opaque marker rows, zero PII. Actual
 * PostgreSQL retention DELETE is restricted to expired rows by FORCE RLS.
 * This does not prove a production privacy policy or a GDPR assessment.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R187 retention: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=s=>createHash('sha256').update(s).digest('hex');
const hash=x=>sha(JSON.stringify(x));
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fields=['runId','sequence','nonce','sourceCommit',
 'r186EvidenceSha256','decision','productionAuthorized'];
const witness=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 /^[a-f0-9]{32}$/.test(x.nonce||'')&&
 H40.test(x.sourceCommit||'')&&H64.test(x.r186EvidenceSha256||'')&&
 x.decision==='NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING'&&
 x.productionAuthorized===false;
const eq=(a,b)=>witness(a)&&witness(b)&&
 fields.every(k=>a[k]===b[k]);
const kinds=['PAGE_VIEW','PUBLIC_EVENT','CHECKOUT_INTENT'];
export function r187SyntheticRetentionRows({commit,runId}={}){
 ok(H40.test(commit||'')&&
  Number.isSafeInteger(runId)&&runId>=10000,
  'full source SHA and run are required for fixtures');
 return Object.freeze(Array.from({length:12},(_,i)=>{
  const n=i+1;
  return Object.freeze({ordinal:n,kind:kinds[i%3],
   sha256:sha('r187-retention:'+commit+':'+runId+':'+n),
   expired:n<=4});
 }));
}
export function createR187PrivacyRetention({
 readR186Hold,quarantine,readRows,deleteExpired,
 clock=()=>Date.now(),allowDisposableWrite=false
}={}){
 ok([readR186Hold,quarantine?.status,readRows,deleteExpired,clock]
  .every(x=>typeof x==='function'),
  'PG17 retention writer/reader and immutable ancestor required');
 const exact=(got,want)=>Array.isArray(got)&&
  got.length===want.length&&got.every((r,i)=>
   r&&Object.getPrototypeOf(r)===Object.prototype&&
   Object.keys(r).sort().join(',')==='expired,kind,ordinal,sha256'&&
   r.ordinal===want[i].ordinal&&r.kind===want[i].kind&&
   r.sha256===want[i].sha256&&r.expired===want[i].expired);
 async function inspect({commit,bundleSha256,runId}={}){
  ok(allowDisposableWrite===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&
   Number.isSafeInteger(runId)&&runId>=10000,
   'only explicitly enabled synthetic disposable PG17 may delete rows');
  const ancestor=await readR186Hold(),guard=await quarantine.status();
  ok(witness(ancestor)&&ancestor.sourceCommit===commit&&
   ancestor.runId===runId&&guard?.closed===true&&
   Number.isSafeInteger(guard.generation)&&guard.generation>=5,
   'immutable source NO-GO or closed quarantine missing');
  const expected=r187SyntheticRetentionRows({commit,runId});
  const before=await readRows();
  ok(exact(before,expected),
   '12 exact synthetic/opaque rows required, no customer data');
  const deleted=await deleteExpired();
  ok(deleted===4,'only four expired synthetic records may be removed');
  const expectedAfter=expected.slice(4);
  const after=await readRows(),ancestorAfter=await readR186Hold(),
   qAfter=await quarantine.status();
  ok(exact(after,expectedAfter)&&eq(ancestor,ancestorAfter)&&
   qAfter?.closed===true&&qAfter.generation===guard.generation,
   'retention altered active rows, immutable NO-GO or quarantine');
  const at=clock();
  ok(Number.isSafeInteger(at)&&at>0,
   'timestamp required for auditable retention evidence');
  const result={
   schemaVersion:1,scope:'disposable-pg17-synthetic-retention-only',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId,sequence:ancestor.sequence,nonce:ancestor.nonce,
   r186EvidenceSha256:ancestor.r186EvidenceSha256,
   syntheticRowsBefore:12,
   syntheticExpiredRowsDeleted:4,
   syntheticActiveRowsRemaining:8,
   beforeRowsSha256:hash(expected),
   afterRowsSha256:hash(expectedAfter),
   rawCustomerDataProcessed:false,
   liveRetentionPolicyEnforced:false,
   realPrivacyComplianceAttested:false,
   quarantineClosed:true,
   decision:'NO_GO_SYNTHETIC_RETENTION_ONLY',
   realPilotAuthorized:false,productionAuthorized:false,
   observedAtMs:at
  };
  return Object.freeze({...result,evidenceSha256:hash(result)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  disposableOnly:true,enabled:allowDisposableWrite,
  realPilotAuthorized:false,productionAuthorized:false})});
}
