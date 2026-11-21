/**
 * R176 signed offsite history: every ancestor must have two valid pinned
 * Ed25519 signatures and an immutable-content hash. Different keys do not
 * establish two real human approvers. No production release authority.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {verifyR175DualAnchor} from '../r175/dual-anchor.mjs';
const H64=/^[a-f0-9]{64}$/,VERSION=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R176 anchor chain: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const keys=x=>Object.keys(x).sort().join(',');
const sha=b=>createHash('sha256').update(b).digest('hex');
const eq=(a,b)=>H64.test(a||'')&&H64.test(b||'')&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function verifyR176AnchorChain({entries,checkpoint,bundleSha256,
 pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
 clock=()=>Date.now()}={}){
 ok(Array.isArray(entries)&&entries.length>=2&&entries.length<=32&&
  H64.test(bundleSha256||'')&&H64.test(pinnedOperatorSpkiSha256||'')&&
  H64.test(pinnedReviewerSpkiSha256||'')&&
  pinnedOperatorSpkiSha256!==pinnedReviewerSpkiSha256&&
  typeof clock==='function','bounded complete genesis history and key pins required');
 ok(checkpoint&&checkpoint.production_authorized===false&&
  Number.isSafeInteger(checkpoint.sequence)&&
  checkpoint.sequence===entries.length,
  'independent high-water must equal complete signed genesis history');
 let parent='0'.repeat(64),issuedAtMs=0;
 const seen=new Set();
 for(let i=0;i<entries.length;i++){
  const e=entries[i];
  ok(e&&Object.getPrototypeOf(e)===Object.prototype&&
   keys(e)==='receipt,sha256,versionId'&&
   H64.test(e.sha256||'')&&VERSION.test(e.versionId||'')&&
   !seen.has(e.sha256),'unique immutable versioned offsite anchor required');
  seen.add(e.sha256);
  const r=e.receipt,m=r?.manifest;
  ok(m&&m.sequence===i+1&&m.priorAnchorSha256===parent&&
   m.bundleSha256===bundleSha256&&m.issuedAtMs>=issuedAtMs,
   'missing parent, sequence gap, source drift or issuance reversal');
  ok(eq(sha(Buffer.from(JSON.stringify(r))),e.sha256),
   'offsite full-content anchor SHA256 mismatch');
  const verified=verifyR175DualAnchor({
   receipt:r,pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
   commit:m.commit,bundleSha256,archiveSha256:m.archiveSha256,
   escrowSha256:m.escrowSha256,checkpointSha256:m.checkpointSha256,
   sequence:i+1,priorAnchorSha256:parent,clock
  });
  ok(verified.verified===true&&verified.productionAuthorized===false,
   'historical Ed25519 signer or receipt rejected');
  parent=verified.anchorSha256;issuedAtMs=m.issuedAtMs;
 }
 const latest=entries.at(-1),m=latest.receipt.manifest;
 ok(m.sequence===checkpoint.sequence&&
  m.commit===checkpoint.source_commit&&
  m.archiveSha256===checkpoint.archive_sha256&&
  m.escrowSha256===checkpoint.escrow_sha256&&
  m.checkpointSha256===checkpoint.evidence_sha256,
  'independent current R174 high-water does not match signed chain tip');
 return Object.freeze({verified:true,genesisVerified:true,
  contiguousEntries:entries.length,anchorTipSha256:parent,
  pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
  latest:Object.freeze({
   sha256:latest.sha256,versionId:latest.versionId,
   expected:Object.freeze({sequence:m.sequence,commit:m.commit,
    bundleSha256,archiveSha256:m.archiveSha256,
    escrowSha256:m.escrowSha256,
    checkpointSha256:m.checkpointSha256,
    priorAnchorSha256:m.priorAnchorSha256})
  }),cryptographicKeysDistinct:true,realHumanApprovalVerified:false,
  productionAuthorized:false});
}
