import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {issueR175DualAnchor} from '../r175/dual-anchor.mjs';
import {createR175RecoverySupervisor} from '../r175/recovery-supervisor.mjs';
const op=generateKeyPairSync('ed25519'),rev=generateKeyPairSync('ed25519');
const clock=()=>1800000000000,nonce='f'.repeat(32);
const info={sequence:1,commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),
 archiveSha256:'c'.repeat(64),escrowSha256:'d'.repeat(64),
 checkpointSha256:'e'.repeat(64),priorAnchorSha256:'0'.repeat(64)};
const receipt=issueR175DualAnchor({data:info,
 operatorKey:op.privateKey,reviewerKey:rev.privateKey,clock});
const input={...info,nonce,anchorSha256:'1'.repeat(64),
 anchorVersionId:'offsite-v4',
 pinnedOperatorSpkiSha256:receipt.approvals[0].signerSpkiSha256,
 pinnedReviewerSpkiSha256:receipt.approvals[1].signerSpkiSha256,
 recoveryArgs:{targetDatabase:'marcosa_r168_restored'}};
function f({wrongCheckpoint=false,anchorTampered=false,
 nonceReplay=false,shiftAfterNonce=false,restoreFailure=false}={}){
 let reads=0,leases=0,restores=0;const incidents=[];
 const circuit={snapshot:()=>({stopped:true}),
  trip:async x=>{incidents.push(x);return{accepted:true};}};
 const flow=createR175RecoverySupervisor({
  clock,allowRecovery:true,emergencyCircuit:circuit,
  readCheckpoint:async()=>{
   reads++;
   return{sequence:wrongCheckpoint?2:shiftAfterNonce&&reads>=3?2:1,
    source_commit:info.commit,archive_sha256:info.archiveSha256,
    escrow_sha256:info.escrowSha256,evidence_sha256:info.checkpointSha256,
    production_authorized:false};
  },
  anchorStore:{read:async()=>({verified:true,
   sha256:input.anchorSha256,versionId:input.anchorVersionId,
   receipt:anchorTampered?{...receipt,anchorSha256:'2'.repeat(64)}:receipt})},
  recoveryNonce:{consume:async x=>{
   leases++;
   if(nonceReplay)throw Error('duplicate');
   return{consumedExactlyOnce:true,nonce:x.nonce,anchorSha256:x.anchorSha256,
    productionAuthorized:false};
  }},
  offsiteRehearsal:async()=>{
   restores++;
   return{verified:!restoreFailure,
    sourceS3AndKmsNotAccessedDuringRestore:true,
    syntheticRowsLost:0,productionAuthorized:false};
  }
 });
 return{flow,counts:()=>({reads,leases,restores,incidents})};
}
test('R175 supervisor verifies dual anchor before any durable nonce and isolated restore',async()=>{
 const x=f(),proof=await x.flow.rehearse(input);
 assert.equal(proof.verified,true);
 assert.equal(proof.realHumanIdentityVerified,false);
 assert.equal(proof.productionAuthorized,false);
 assert.deepEqual(x.counts(),{reads:3,leases:1,restores:1,incidents:[]});
});
test('R175 supervisor rejects rollback, signer tamper, nonce replay, TOCTOU and failed restore',async()=>{
 for(const e of [{wrongCheckpoint:true},{anchorTampered:true},
  {nonceReplay:true},{shiftAfterNonce:true},{restoreFailure:true}]){
  const x=f(e);
  await assert.rejects(x.flow.rehearse(input),/R175 recovery supervisor/);
  assert.equal(x.counts().incidents.length,1);
  assert.equal(x.counts().restores,e.restoreFailure?1:0);
 }
});
test('R175 refuses restore without explicit isolated operator opt in',async()=>{
 const x=createR175RecoverySupervisor({
  readCheckpoint:async()=>{throw Error('network');},
  anchorStore:{read:async()=>{throw Error('network');}},
  recoveryNonce:{consume:async()=>{throw Error('network');}},
  offsiteRehearsal:async()=>{throw Error('network');},
  emergencyCircuit:{trip:async()=>{},snapshot:()=>({stopped:true})}
 });
 await assert.rejects(x.rehearse(input),/disabled by default/);
});
