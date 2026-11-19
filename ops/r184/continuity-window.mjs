/**
 * R184 true disposable PostgreSQL17 8+24 event snapshot boundary exercise:
 * - 8 baseline events -> native pg_dump -Fc
 * - 24 new events on source -> restore snapshot into NEW isolated database
 * - restored has 8; source has 32; post-snapshot WAL grew >0 bytes
 * - previous R183 NO-GO and closed quarantine remain identical
 *
 * These are *synthetic* loss events; no customer/production RPO or
 * production data is involved.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const fail=m=>{throw Error('R184 continuity window: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const raw=x=>createHash('sha256').update(x).digest('hex');
const hash=x=>raw(JSON.stringify(x));
const FIELDS=['runId','sequence','nonce','sourceCommit',
 'r183EvidenceSha256','decision','rlsEnforced','productionAuthorized'];
const witness=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===FIELDS.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 /^[a-f0-9]{32}$/.test(x.nonce||'')&&H40.test(x.sourceCommit||'')&&
 H64.test(x.r183EvidenceSha256||'')&&
 x.decision==='NO_GO_REAL_PILOT_EVIDENCE_PENDING'&&
 x.rlsEnforced===true&&x.productionAuthorized===false;
const same=(a,b)=>witness(a)&&witness(b)&&
 FIELDS.every(k=>a[k]===b[k]);
export function createR184ContinuityWindow({
 readR183Witness,readQuarantine,readEvents,
 writeEvents,dumpSource,restoreToIsolated,
 readWalPosition,readWalGrowth,
 monotonic=()=>performance.now(),clock=()=>Date.now(),
 allowDisposableRestore=false
}={}){
 ok([readR183Witness,readQuarantine,readEvents,writeEvents,
  dumpSource,restoreToIsolated,readWalPosition,readWalGrowth,
  monotonic,clock].every(fn=>typeof fn==='function'),
  'source-bound native PG17 read/dump/write/restore/WAL callbacks required');
 async function inspect({commit,bundleSha256,runId,
  restoreDatabase='marcosa_r184_snapshot',
  maxRestoreMs=120000}={}){
  ok(allowDisposableRestore===true&&
   restoreDatabase==='marcosa_r184_snapshot'&&
   H40.test(commit||'')&&H64.test(bundleSha256||'')&&
   Number.isSafeInteger(runId)&&runId>=10000&&
   Number.isSafeInteger(maxRestoreMs)&&
   maxRestoreMs>=1000&&maxRestoreMs<=180000,
   'only predetermined temporary PG17 restore DB and exact source permitted');
  const before=await readR183Witness('postgres');
  const qBefore=await readQuarantine();
  ok(witness(before)&&before.sourceCommit===commit&&
   before.runId===runId&&qBefore?.closed===true&&
   Number.isSafeInteger(qBefore.generation)&&qBefore.generation>=5,
   'previous immutable PG17 hold and quarantine must be closed');
  const all=Array.from({length:32},(_,i)=>({
   ordinal:i+1,sha256:raw('r184-event:'+commit+':'+runId+':'+(i+1))
  }));
  const equal=(a,b)=>Array.isArray(a)&&a.length===b.length&&
   a.every((x,i)=>x&&Object.keys(x).sort().join(',')==='ordinal,sha256'&&
    x.ordinal===b[i].ordinal&&x.sha256===b[i].sha256);
  ok(equal(await readEvents('postgres'),[]),
   'new disposable continuity table cannot have pre-existing writes');
  await writeEvents(all.slice(0,8),'BASELINE',{commit,runId});
  ok(equal(await readEvents('postgres'),all.slice(0,8)),
   'eight native baseline transactions missing before snapshot');
  const start=monotonic(),beginWal=await readWalPosition();
  ok(Number.isFinite(start)&&start>=0&&
   /^[0-9A-F]+\/[0-9A-F]+$/.test(beginWal||''),
   'positive monotonic timer and native WAL position required');
  let dump,elapsed;
  try{
   dump=await dumpSource();
   ok(Buffer.isBuffer(dump)&&dump.length>=512&&
    dump.length<=45*1024*1024&&
    dump.subarray(0,5).toString('utf8')==='PGDMP',
    'bounded native PostgreSQL17 custom-format snapshot required');
   await writeEvents(all.slice(8),'AFTER_SNAPSHOT',{commit,runId});
   ok(equal(await readEvents('postgres'),all),
    'all 24 distinct source post-snapshot events must be durable');
   await restoreToIsolated({database:restoreDatabase,bytes:dump,
    expectedCommit:commit,expectedSourceSha256:before.r183EvidenceSha256});
   elapsed=Math.ceil(monotonic()-start);
   ok(Number.isSafeInteger(elapsed)&&elapsed>=1&&
    elapsed<=maxRestoreMs,'disposable snapshot restore exceeded budget');
  }finally{if(Buffer.isBuffer(dump))dump.fill(0);}
  const [restoredEvents,primaryEvents,restoredHold,sourceHold,qAfter,
   walGrowth]=await Promise.all([
    readEvents(restoreDatabase),readEvents('postgres'),
    readR183Witness(restoreDatabase),readR183Witness('postgres'),
    readQuarantine(),readWalGrowth(beginWal)
   ]);
  ok(equal(restoredEvents,all.slice(0,8))&&
   equal(primaryEvents,all)&&same(before,restoredHold)&&
   same(before,sourceHold)&&qAfter?.closed===true&&
   qAfter.generation===qBefore.generation&&
   Number.isSafeInteger(walGrowth)&&walGrowth>0&&walGrowth<100000000,
   'disposable restored source/new events, WAL, RLS or quarantine mismatch');
  const timestamp=clock();
  ok(Number.isSafeInteger(timestamp)&&timestamp>0,
   'trusted immutable audit timestamp missing');
  const record={
   schemaVersion:1,scope:'disposable-postgres17-only',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId,sequence:before.sequence,nonce:before.nonce,
   r183EvidenceSha256:before.r183EvidenceSha256,
   sourceEventCount:32,restoredSnapshotEventCount:8,
   intentionallyExcludedPostSnapshotEvents:24,
   sourceEventSequenceSha256:hash(all),
   restoredSequenceSha256:hash(all.slice(0,8)),
   observedSourcePostSnapshotWalBytes:walGrowth,
   measuredDisposableRestoreMs:elapsed,
   configuredTestBudgetMs:maxRestoreMs,
   realProductionRpoRtoVerified:false,
   realProductionEventsExamined:false,
   closedQuarantinePreserved:true,
   productionAuthorized:false,observedAtMs:timestamp,
   decision:'NO_GO_SYNTHETIC_CONTINUITY_WINDOW_ONLY'
  };
  return Object.freeze({...record,evidenceSha256:hash(record)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowDisposableRestore,disposableOnly:true,
  realPilotAuthorized:false,productionAuthorized:false})});
}
