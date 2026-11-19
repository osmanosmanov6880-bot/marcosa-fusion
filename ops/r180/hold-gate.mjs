/**
 * R180 operational controller: independently reread R179 native PG17 source,
 * verify exact report & distinct Ed25519 signatures, record a ONE-TIME
 * immutable NO-GO, independently reread it, retain closed quarantine.
 * Never deploy, mutate source, recover production or grant permission.
 */
import {classifyR180Evidence,verifyR180Classification}
 from './evidence-classifier.mjs';
import {verifyR180Quorum} from './quorum-attestation.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R180 hold gate: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const fields=[
 'runId','sequence','nonce','sourceCommit','historyRootSha256',
 'archiveSha256','restoredStateSha256','reviewEvidenceSha256',
 'decision','productionAuthorized'
];
const same=(a,b)=>a&&b&&fields.every(k=>a[k]===b[k]);
function matches(w,classify){
 return w&&
  Object.getPrototypeOf(w)===Object.prototype&&
  Object.keys(w).sort().join(',')===fields.slice().sort().join(',')&&
  w.runId===classify.runId&&w.sequence===classify.sequence&&
  w.nonce===classify.nonce&&
  w.sourceCommit===classify.sourceCommit&&
  w.historyRootSha256===classify.historyRootSha256&&
  w.archiveSha256===classify.archiveSha256&&
  w.restoredStateSha256===classify.restoredStateSha256&&
  w.reviewEvidenceSha256===classify.reviewEvidenceSha256&&
  w.decision==='CI_SIMULATED_REVIEW_ONLY'&&
  w.productionAuthorized===false;
}
export function createR180HoldGate({readR179Witness,holdLedger,
 readRecordedHold,quarantine,incidentCircuit,
 clock=()=>Date.now(),allowHold=false}={}){
 ok(typeof readR179Witness==='function'&&
  holdLedger&&typeof holdLedger.record==='function'&&
  typeof readRecordedHold==='function'&&
  quarantine&&typeof quarantine.status==='function'&&
  incidentCircuit&&typeof incidentCircuit.trip==='function'&&
  typeof clock==='function',
  'independent PostgreSQL readback, append-only ledger and stopped circuit required');
 async function record({report,classification,quorum,
  commit,bundleSha256,expectedOperatorPin,expectedAuditorPin}={}){
  ok(allowHold===true,'one-use NO-GO hold disabled by default');
  let source;
  try{
   ok(H40.test(commit||'')&&H64.test(bundleSha256||''),
    'exact source SHA and reproducible source bundle required');
   verifyR180Classification(classification,{commit,bundleSha256,clock});
   const independentlyDerived=classifyR180Evidence(report,{
    commit,bundleSha256,clock:()=>classification.classifiedAtMs
   });
   ok(independentlyDerived.evidenceSha256===classification.evidenceSha256,
    'R179 report changed after NO-GO classification');
   verifyR180Quorum(quorum,{commit,bundleSha256,
    classificationSha256:classification.evidenceSha256,
    expectedOperatorPin,expectedAuditorPin,clock});
   ok(quorum.packet.reviewEvidenceSha256===
      classification.reviewEvidenceSha256&&
    quorum.packet.runId===classification.runId&&
    quorum.packet.sequence===classification.sequence&&
    quorum.packet.nonce===classification.nonce&&
    quorum.packet.decision===classification.decision,
    'dual-signed packet not about this exact R179 no-go');
   const before=await readR179Witness();
   source=before;
   ok(matches(before,classification),
    'native R179 source evidence mismatch');
   const previous=await quarantine.status();
   ok(previous?.closed===true&&
    Number.isSafeInteger(previous.generation)&&
    previous.generation>=5,
    'durable source quarantine not closed');
   const again=await readR179Witness();
   ok(same(before,again)&&matches(again,classification),
    'R179 high-water moved before NO-GO hold append');
   const proposed={
    runId:classification.runId,sequence:classification.sequence,
    nonce:classification.nonce,sourceCommit:commit,
    historyRootSha256:classification.historyRootSha256,
    archiveSha256:classification.archiveSha256,
    restoredStateSha256:classification.restoredStateSha256,
    reviewEvidenceSha256:classification.reviewEvidenceSha256,
    classificationSha256:classification.evidenceSha256,
    quorumReceiptSha256:quorum.receiptSha256,
    operatorPinSha256:expectedOperatorPin,
    auditorPinSha256:expectedAuditorPin,
    blockerCount:classification.blockers.length,
    decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING'
   };
   const saved=await holdLedger.record(proposed);
   ok(saved?.recorded===true&&
    saved.classificationSha256===proposed.classificationSha256&&
    saved.quorumReceiptSha256===proposed.quorumReceiptSha256&&
    saved.decision===proposed.decision&&
    saved.productionAuthorized===false,
    'atomic PostgreSQL NO-GO and audit were not durably inserted');
   const verified=await readRecordedHold();
   ok(verified&&Object.getPrototypeOf(verified)===Object.prototype&&
    ['runId','sequence','nonce','sourceCommit',
     'classificationSha256','quorumReceiptSha256',
     'decision','productionAuthorized'].every(k=>
      verified[k]=== (k==='runId'||k==='sequence'||k==='nonce'||
       k==='sourceCommit'?proposed[k]:
       k==='classificationSha256'||k==='quorumReceiptSha256'?
        proposed[k]:k==='decision'?proposed.decision:false))&&
    Object.keys(verified).length===8,
    'NO-GO hold not independently read back from native PostgreSQL');
   const after=await readR179Witness();
   const guard=await quarantine.status();
   ok(same(before,after)&&matches(after,classification)&&
    guard?.closed===true&&guard.generation===previous.generation,
    'source evidence or isolation barrier moved after durable hold');
   return Object.freeze({
    recordedNoGo:true,decision:'NO_GO_EXTERNAL_EVIDENCE_PENDING',
    blockerCount:proposed.blockerCount,
    classificationSha256:proposed.classificationSha256,
    quorumReceiptSha256:proposed.quorumReceiptSha256,
    cryptographicKeysDistinct:true,
    actualHumanApprovalsVerified:false,
    actualLiveAwsVerified:false,
    quarantineRemainsClosed:true,
    productionAuthorized:false
   });
  }catch{
   try{await incidentCircuit.trip({
    type:'ARCHIVE_ROLLBACK',reason:'R180_NO_GO_HOLD_DENIED',
    commit:H40.test(source?.sourceCommit||'')?
     source.sourceCommit:'0'.repeat(40),
    archiveSha256:H64.test(source?.archiveSha256||'')?
     source.archiveSha256:'0'.repeat(64)
   });}catch{fail('hold failed and independent incident audit unavailable');}
   fail('source, quorum, durable NO-GO or closed quarantine rejected');
  }
 }
 return Object.freeze({record,publicStatus:()=>({
  enabled:allowHold,noAutoDeploy:true,productionAuthorized:false
 })});
}
