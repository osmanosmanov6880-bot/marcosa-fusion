/**
 * R183 disposable PostgreSQL17 snapshot/delta exercise.
 *
 * Write ONE synthetic baseline marker; take a native pg_dump -Fc; write
 * ONE post-backup marker to source; restore to a NEW isolated database;
 * require the snapshot to retain baseline but to EXCLUDE post-backup.
 *
 * Shows a deliberately induced one-event recovery gap, not actual
 * production RPO. Does not perform a restore on real source databases.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const fail=m=>{throw Error('R183 delta drill: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,
 H32=/^[a-f0-9]{32}$/;
const sha=x=>createHash('sha256').update(x).digest('hex');
const fields=['runId','sequence','nonce','sourceCommit','r182EvidenceSha256',
 'decision','rlsEnforced','productionAuthorized'];
function valid(x){
 return x&&Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
  Number.isSafeInteger(x.runId)&&x.runId>=10000&&
  Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
  H32.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
  H64.test(x.r182EvidenceSha256||'')&&
  x.decision==='NO_GO_INDEPENDENT_ATTESTATION_PENDING'&&
  x.rlsEnforced===true&&x.productionAuthorized===false;
}
const equal=(a,b)=>valid(a)&&valid(b)&&
 fields.every(k=>a[k]===b[k]);
const marker=(kind,hash)=>({kind,sha256:hash});
const isSame=(array,expected)=>Array.isArray(array)&&
 array.length===expected.length&&
 array.every((x,i)=>x&&Object.keys(x).sort().join(',')==='kind,sha256'&&
  x.kind===expected[i].kind&&x.sha256===expected[i].sha256);
export function createR183DeltaRecovery({
 readR182Witness,quarantine,writeBaseline,dumpSource,
 writeAfterBackup,restoreToIsolated,readMarkers,
 monotonic=()=>performance.now(),clock=()=>Date.now(),
 allowDisposableRestore=false
}={}){
 ok([readR182Witness,quarantine?.status,writeBaseline,dumpSource,
  writeAfterBackup,restoreToIsolated,readMarkers,
  monotonic,clock].every(x=>typeof x==='function'),
  'native immutable source, marker writer and disposable PG17 restore required');
 async function inspect({commit,bundleSha256,runId,
  targetDatabase='marcosa_r183_delta',maxDurationMs=120000}={}){
  ok(allowDisposableRestore===true&&targetDatabase==='marcosa_r183_delta'&&
   H40.test(commit||'')&&H64.test(bundleSha256||'')&&
   Number.isSafeInteger(runId)&&runId>=10000&&
   Number.isSafeInteger(maxDurationMs)&&
   maxDurationMs>=1000&&maxDurationMs<=180000,
   'only explicit disposable PostgreSQL restore and source-pinned budget permitted');
  const before=await readR182Witness('postgres');
  const initial=await quarantine.status();
  ok(valid(before)&&before.runId===runId&&before.sourceCommit===commit&&
   initial?.closed===true&&Number.isSafeInteger(initial.generation)&&
   initial.generation>=5,'real R182 no-go and closed quarantine missing');
  const baseline=marker('BASELINE',sha('r183-base:'+commit+':'+runId));
  const late=marker('POST_BACKUP',sha('r183-late:'+commit+':'+runId));
  ok(isSame(await readMarkers('postgres'),[]),
   'new disposable source must not already contain markers');
  await writeBaseline(baseline,{commit,runId});
  ok(isSame(await readMarkers('postgres'),[baseline]),
   'synthetic baseline was not durably recorded before dump');
  let dump;
  const start=monotonic();
  let elapsed;
  try{
   ok(Number.isFinite(start)&&start>=0,'monotonic recovery timer invalid');
   dump=await dumpSource();
   ok(Buffer.isBuffer(dump)&&dump.length>=512&&
    dump.length<=40*1024*1024&&
    dump.subarray(0,5).toString('utf8')==='PGDMP',
    'native bounded PG17 custom snapshot required');
   await writeAfterBackup(late,{commit,runId});
   ok(isSame(await readMarkers('postgres'),[baseline,late]),
    'post-backup synthetic source delta not durably present');
   await restoreToIsolated({database:targetDatabase,bytes:dump,
    expectedRunId:runId,expectedSourceSha256:before.r182EvidenceSha256});
   elapsed=Math.ceil(monotonic()-start);
   ok(Number.isSafeInteger(elapsed)&&elapsed>=1&&
    elapsed<=maxDurationMs,'disposable delta restore time budget exceeded');
  }finally{if(Buffer.isBuffer(dump))dump.fill(0);}
  const [restored,sourceAfter,after,guard]=await Promise.all([
   readR182Witness(targetDatabase),readR182Witness('postgres'),
   readMarkers(targetDatabase),quarantine.status()
  ]);
  ok(equal(before,restored)&&equal(before,sourceAfter)&&
   isSame(after,[baseline])&&
   isSame(await readMarkers('postgres'),[baseline,late])&&
   guard?.closed===true&&guard.generation===initial.generation,
   'snapshot lost baseline, included future delta or mutated R182/quarantine');
  const observed=clock();
  ok(Number.isSafeInteger(observed)&&observed>0,
   'bounded test evidence timestamp required');
  const data={
   schemaVersion:1,scope:'disposable-postgres17-synthetic-delta-only',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId,sequence:before.sequence,nonce:before.nonce,
   r182EvidenceSha256:before.r182EvidenceSha256,
   baselineMarkerSha256:baseline.sha256,
   afterBackupMarkerSha256:late.sha256,
   postBackupSourceMarkerCount:2,
   restoredSnapshotMarkerCount:1,
   intentionallyMissingPostBackupEvents:1,
   measuredDisposableRestoreMs:elapsed,
   configuredTestBudgetMs:maxDurationMs,
   productionDataLossMeasured:false,
   realProductionRpoRtoVerified:false,
   quarantineRemainsClosed:true,
   productionAuthorized:false,observedAtMs:observed,
   decision:'NO_GO_SYNTHETIC_DELTA_ONLY'
  };
  return Object.freeze({...data,evidenceSha256:sha(JSON.stringify(data))});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  disposableOnly:true,enabled:allowDisposableRestore,
  productionAuthorized:false})});
}
