/**
 * R176: history read BEFORE any SQL nonce, then R175 supervisor with both
 * durable SQL fences BEFORE an isolated source-independent restore.
 */
import {createR175RecoverySupervisor} from '../r175/recovery-supervisor.mjs';
import {createR176CompositeNonce} from './recovery-fence.mjs';
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R176 recovery guard: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const same=(a,b)=>a&&b&&[
 'sequence','source_commit','archive_sha256','escrow_sha256',
 'evidence_sha256','production_authorized'
].every(k=>a[k]===b[k]);
export function createR176RecoveryGuard({readCheckpoint,chainReader,
 anchorStore,r175Nonce,r176Fence,offsiteRehearsal,
 emergencyCircuit,clock=()=>Date.now(),allowRecovery=false}={}){
 ok(typeof readCheckpoint==='function'&&
  chainReader&&typeof chainReader.read==='function'&&
  anchorStore&&typeof anchorStore.read==='function'&&
  r175Nonce&&typeof r175Nonce.consume==='function'&&
  r176Fence&&typeof r176Fence.admit==='function'&&
  typeof offsiteRehearsal==='function'&&
  emergencyCircuit&&typeof emergencyCircuit.trip==='function'&&
  typeof emergencyCircuit.snapshot==='function'&&
  typeof clock==='function',
  'pinned independent history, checkpoint, nonce and circuit required');
 async function rehearse({locators,bundleSha256,nonce,
  pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,recoveryArgs}={}){
  ok(allowRecovery===true,'offsite recovery disabled by default');
  ok(emergencyCircuit.snapshot().stopped===true,
   'emergency isolation circuit must already be stopped');
  let checkpoint,enteredR175=false;
  try{
   checkpoint=await readCheckpoint();
   const chain=await chainReader.read({locators,checkpoint,bundleSha256});
   ok(chain?.verified===true&&chain.genesisVerified===true&&
    chain.latest?.expected?.sequence===checkpoint?.sequence&&
    chain.latest.expected.checkpointSha256===checkpoint.evidence_sha256&&
    chain.pinnedOperatorSpkiSha256===pinnedOperatorSpkiSha256&&
    chain.pinnedReviewerSpkiSha256===pinnedReviewerSpkiSha256&&
    chain.productionAuthorized===false,
    'history invalid or signer pins differ');
   const again=await readCheckpoint();
   ok(same(checkpoint,again),'checkpoint changed during historical verification');
   const composite=createR176CompositeNonce({r175Nonce,r176Fence,
    checkpointSha256:again.evidence_sha256});
   const supervisor=createR175RecoverySupervisor({
    readCheckpoint,anchorStore,recoveryNonce:composite,
    offsiteRehearsal,emergencyCircuit,clock,allowRecovery:true
   });
   enteredR175=true;
   const restored=await supervisor.rehearse({
    ...chain.latest.expected,nonce,
    anchorSha256:chain.latest.sha256,
    anchorVersionId:chain.latest.versionId,
    pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
    recoveryArgs
   });
   ok(restored?.verified===true&&restored.nonceCommitted===true&&
    restored.productionAuthorized===false,
    'isolated source-independent restore proof rejected');
   return Object.freeze({verified:true,
    contiguousSignedAnchors:chain.contiguousEntries,
    sequenceFenceVerified:true,nonceCommitted:true,
    realHumanApprovalVerified:false,actualRealAwsAccountUsed:false,
    productionAuthorized:false});
  }catch{
   if(!enteredR175){
    try{await emergencyCircuit.trip({
     type:'ARCHIVE_ROLLBACK',reason:'R176_HISTORY_DENIED',
     commit:H40.test(checkpoint?.source_commit||'')?
      checkpoint.source_commit:'0'.repeat(40),
     archiveSha256:H64.test(checkpoint?.archive_sha256||'')?
      checkpoint.archive_sha256:'0'.repeat(64)
    });}catch{fail('history failed and independent incident ledger unavailable');}
   }
   fail('chain, durable admission or isolated restore denied');
  }
 }
 return Object.freeze({rehearse,publicStatus:()=>({
  allowed:allowRecovery,productionAuthorized:false
 })});
}
