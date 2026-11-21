/**
 * R182 disposable PostgreSQL17 RTO drill. Uses real pg_dump -Fc +
 * pg_restore in CI; measures elapsed restore duration with monotonic clock.
 * Matching isolated source/restore rows imply ZERO observed snapshot loss
 * inside this frozen fixture; not a real production RPO/RTO measurement.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const fail=m=>{throw Error('R182 recovery drill: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=['runId','sequence','nonce','sourceCommit',
 'r181EvidenceSha256','r180ClassificationSha256',
 'r180QuorumReceiptSha256','holdDecision','observationDecision',
 'quarantineClosed','rlsEnforced','productionAuthorized'];
function valid(s){
 return s&&Object.getPrototypeOf(s)===Object.prototype&&
  Object.keys(s).sort().join(',')===fields.slice().sort().join(',')&&
  Number.isSafeInteger(s.runId)&&s.runId>=10000&&
  Number.isSafeInteger(s.sequence)&&s.sequence>=2&&s.sequence<=32&&
  H32.test(s.nonce||'')&&H40.test(s.sourceCommit||'')&&
  ['r181EvidenceSha256','r180ClassificationSha256',
   'r180QuorumReceiptSha256'].every(x=>H64.test(s[x]||''))&&
  s.holdDecision==='NO_GO_EXTERNAL_EVIDENCE_PENDING'&&
  s.observationDecision==='NO_GO_PROVIDER_ATTESTATION_PENDING'&&
  s.quarantineClosed===true&&s.rlsEnforced===true&&
  s.productionAuthorized===false;
}
const same=(a,b)=>valid(a)&&valid(b)&&
 fields.every(k=>a[k]===b[k]);
export function createR182RecoveryDrill({readSource,dumpSource,
 restoreToIsolated,readRestored,readQuarantine,
 monotonic=()=>performance.now(),clock=()=>Date.now(),
 allowDisposableRestore=false}={}){
 ok([readSource,dumpSource,restoreToIsolated,readRestored,
  readQuarantine,monotonic,clock].every(f=>typeof f==='function'),
  'read-only source and isolated disposable restore callbacks required');
 async function inspect({commit,bundleSha256,runId,
  maxRtoMs=120000,targetDatabase='marcosa_r182_drill'}={}){
  ok(allowDisposableRestore===true&&
   targetDatabase==='marcosa_r182_drill'&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&
   Number.isSafeInteger(runId)&&runId>=10000&&
   Number.isSafeInteger(maxRtoMs)&&
   maxRtoMs>=1000&&maxRtoMs<=180000,
   'only allowlisted disposable PostgreSQL17 restoration target and budget');
  const q1=await readQuarantine(),before=await readSource();
  ok(q1?.closed===true&&
   Number.isSafeInteger(q1.generation)&&q1.generation>=5&&
   valid(before)&&before.runId===runId&&
   before.sourceCommit===commit,
   'frozen R180/R181 source or closed quarantine missing');
  let dump;
  let start,elapsed;
  try{
   start=monotonic();
   ok(Number.isFinite(start)&&start>=0,'monotonic start invalid');
   dump=await dumpSource();
   ok(Buffer.isBuffer(dump)&&dump.length>=512&&
    dump.length<=40*1024*1024&&
    dump.subarray(0,5).toString('utf8')==='PGDMP',
    'native PostgreSQL custom-format backup required');
   await restoreToIsolated({
    database:targetDatabase,bytes:dump,
    expectedCommit:commit,expectedSourceSha256:before.r181EvidenceSha256
   });
   elapsed=Math.ceil(monotonic()-start);
   ok(Number.isSafeInteger(elapsed)&&elapsed>=1&&elapsed<=maxRtoMs,
    'measured isolated restore missed the explicit test budget');
  }finally{if(Buffer.isBuffer(dump))dump.fill(0);}
  const restored=await readRestored(targetDatabase);
  const after=await readSource(),q2=await readQuarantine();
  ok(same(before,restored)&&same(before,after)&&
   q2?.closed===true&&q2.generation===q1.generation,
   'isolated restored PostgreSQL RLS, high-water, quarantine or NO-GO changed');
  const ms=clock();
  ok(Number.isSafeInteger(ms)&&ms>0,'trusted observation timestamp');
  const data={
   schemaVersion:1,scope:'disposable-postgres17-only',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId,sequence:before.sequence,nonce:before.nonce,
   r181EvidenceSha256:before.r181EvidenceSha256,
   r180ClassificationSha256:before.r180ClassificationSha256,
   r180QuorumReceiptSha256:before.r180QuorumReceiptSha256,
   measuredRestoreMs:elapsed,configuredTestBudgetMs:maxRtoMs,
   observedFrozenSnapshotLossMs:0,
   twoIndependentNativePgReadbacks:true,
   sameNoGoAndRlsInIsolatedRestore:true,
   realProductionRpoRtoMeasured:false,
   realProviderAttestationVerified:false,
   productionAuthorized:false,observedAtMs:ms,
   decision:'NO_GO_PRODUCTION_RPO_RTO_NOT_MEASURED'
  };
  return Object.freeze({...data,evidenceSha256:sha(data)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  disposableOnly:true,enabled:allowDisposableRestore,
  productionAuthorized:false})});
}
