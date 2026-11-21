/**
 * R177: R176 dual-signature offsite readback -> monotonic PostgreSQL witness.
 * R176 authenticates all supplied versions. Reconcile never fetches source
 * AWS or infers "latest" and never equates keys to real human approvals.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R177 offsite reconciliation: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const eq=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const same=(a,b)=>a&&b&&[
 'sequence','source_commit','archive_sha256','escrow_sha256',
 'evidence_sha256','production_authorized'
].every(k=>a[k]===b[k]);
const canonical=r=>({
 sequence:r.sequence,sourceCommit:r.sourceCommit,
 archiveSha256:r.archiveSha256,checkpointSha256:r.checkpointSha256,
 anchorSha256:r.anchorSha256,objectSha256:r.objectSha256,
 versionId:r.versionId,priorAnchorSha256:r.priorAnchorSha256
});
export function r177HistoryDigest(rows){
 ok(Array.isArray(rows)&&rows.length>=2&&rows.length<=32,
  'complete bounded historical archive ledger required');
 const checked=rows.map(canonical);
 for(let i=0;i<checked.length;i++){
  const r=checked[i];
  ok(r.sequence===i+1&&/^[a-f0-9]{40}$/.test(r.sourceCommit||'')&&
   [r.archiveSha256,r.checkpointSha256,r.anchorSha256,
    r.objectSha256,r.priorAnchorSha256].every(x=>H64.test(x||''))&&
   /^[A-Za-z0-9_.-]{1,128}$/.test(r.versionId||'')&&
   r.priorAnchorSha256===(i===0?'0'.repeat(64):
    checked[i-1].anchorSha256),
   'historical row tampered, predecessor lost or sequence skipped');
 }
 return hash(Buffer.from(JSON.stringify({schemaVersion:1,
  scope:'r177-isolated-signed-history',rows:checked,
  productionAuthorized:false})));
}
export function createR177OffsiteReconciler({readCheckpoint,
 chainReader,witnessStore,readWitnesses,incidentCircuit,
 allowReconcile=false}={}){
 ok(typeof readCheckpoint==='function'&&
  chainReader&&typeof chainReader.read==='function'&&
  witnessStore&&typeof witnessStore.append==='function'&&
  typeof witnessStore.finalize==='function'&&
  typeof readWitnesses==='function'&&
  incidentCircuit&&typeof incidentCircuit.trip==='function'&&
  typeof incidentCircuit.snapshot==='function',
  'source-independent R176 signed reader, PG ledger and incident gate required');
 async function reconcile({locators,bundleSha256,
  pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256}={}){
  ok(allowReconcile===true&&incidentCircuit.snapshot().stopped===true,
   'explicit isolated opt-in and closed incident circuit required');
  let checkpoint,started=false;
  try{
   const snapshot=JSON.stringify(locators);
   checkpoint=await readCheckpoint();
   const proof=await chainReader.read({locators,checkpoint,bundleSha256});
   ok(proof?.verified===true&&proof.genesisVerified===true&&
    proof.contiguousEntries===locators?.length&&
    proof.latest?.expected?.sequence===checkpoint?.sequence&&
    proof.latest.expected.checkpointSha256===checkpoint.evidence_sha256&&
    proof.pinnedOperatorSpkiSha256===pinnedOperatorSpkiSha256&&
    proof.pinnedReviewerSpkiSha256===pinnedReviewerSpkiSha256&&
    proof.productionAuthorized===false,
    'signed S3 history, R174 high-water or pinned signer mismatch');
   ok(snapshot===JSON.stringify(locators),'S3 locator mutated during verification');
   const second=await readCheckpoint();
   ok(same(checkpoint,second),'R174 high-water advanced during offsite inspection');
   const rows=locators.map((x,i)=>({
    sequence:i+1,
    sourceCommit:x.expected.commit,
    archiveSha256:x.expected.archiveSha256,
    checkpointSha256:x.expected.checkpointSha256,
    anchorSha256:i+1===locators.length?proof.anchorTipSha256:
     locators[i+1].expected.priorAnchorSha256,
    objectSha256:x.sha256,versionId:x.versionId,
    priorAnchorSha256:x.expected.priorAnchorSha256
   }));
   const rootSha256=r177HistoryDigest(rows);
   started=true;
   for(const row of rows){
    const written=await witnessStore.append(row);
    ok(written?.recorded===true&&written.sequence===row.sequence&&
     written.anchorSha256===row.anchorSha256&&
     written.productionAuthorized===false,
     'native PG17 immutable append failed');
   }
   const reread=await readWitnesses();
   ok(Array.isArray(reread)&&reread.length===rows.length&&
    eq(r177HistoryDigest(reread),rootSha256)&&
    rows.every((row,i)=>JSON.stringify(canonical(row))===
     JSON.stringify(canonical(reread[i]))),
    'independent PG17 readback altered source history or parent');
   const third=await readCheckpoint();
   ok(same(checkpoint,third),'high-water advanced after witness commit');
   const final=await witnessStore.finalize({
    sequence:checkpoint.sequence,rootSha256,
    latestObjectSha256:rows.at(-1).objectSha256,
    checkpointSha256:checkpoint.evidence_sha256
   });
   ok(final?.finalized===true&&eq(final.rootSha256,rootSha256)&&
    final.productionAuthorized===false,
    'append-only historical root was not committed');
   return Object.freeze({verified:true,sequence:checkpoint.sequence,
    anchorCount:rows.length,rootSha256,
    latestObjectSha256:rows.at(-1).objectSha256,
    sourceAwsAccessed:false,realHumansVerified:false,
    productionAuthorized:false});
  }catch{
   try{await incidentCircuit.trip({type:'ARCHIVE_ROLLBACK',
    reason:started?'R177_WITNESS_DENIED':'R177_HISTORY_DENIED',
    commit:/^[a-f0-9]{40}$/.test(checkpoint?.source_commit||'')?
     checkpoint.source_commit:'0'.repeat(40),
    archiveSha256:H64.test(checkpoint?.archive_sha256||'')?
     checkpoint.archive_sha256:'0'.repeat(64)
   });}catch{fail('history failed and incident ledger did not persist');}
   fail('signed offsite archive reconciliation or PostgreSQL append-only evidence rejected');
  }
 }
 return Object.freeze({reconcile,publicStatus:()=>({
  enabled:allowReconcile,productionAuthorized:false})});
}
