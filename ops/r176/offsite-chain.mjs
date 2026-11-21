/**
 * R176 complete version-pinned offsite history. Reuses R175 protected S3
 * HEAD and full GET, checks encrypted COMPLIANCE state and signatures.
 * No unversioned 'latest' or source AWS calls.
 */
import {verifyR176AnchorChain} from './chain-verifier.mjs';
const H64=/^[a-f0-9]{64}$/,VERSION=/^[A-Za-z0-9_.-]{1,128}$/;
const fail=m=>{throw Error('R176 offsite history: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const keys=x=>Object.keys(x).sort().join(',');
const expectedKeys='archiveSha256,bundleSha256,checkpointSha256,commit,escrowSha256,priorAnchorSha256,sequence';
export function createR176OffsiteChainReader({anchorStore,
 pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,
 clock=()=>Date.now(),allowRead=false}={}){
 ok(anchorStore&&typeof anchorStore.read==='function'&&
  H64.test(pinnedOperatorSpkiSha256||'')&&
  H64.test(pinnedReviewerSpkiSha256||'')&&
  pinnedOperatorSpkiSha256!==pinnedReviewerSpkiSha256&&
  typeof clock==='function','strict offsite store and pinned independent keys required');
 async function read({locators,checkpoint,bundleSha256}={}){
  ok(allowRead===true,'source-independent history disabled by default');
  ok(Array.isArray(locators)&&locators.length>=2&&locators.length<=32,
   'explicit genesis-to-latest version list required');
  const entries=[];
  for(const x of locators){
   ok(x&&Object.getPrototypeOf(x)===Object.prototype&&
    keys(x)==='expected,sha256,versionId'&&
    H64.test(x.sha256||'')&&VERSION.test(x.versionId||'')&&
    x.expected&&Object.getPrototypeOf(x.expected)===Object.prototype&&
    keys(x.expected)===expectedKeys&&
    x.expected.bundleSha256===bundleSha256,
    'unsigned locator or incomplete exact historical pin');
   const read=await anchorStore.read({
    sha256:x.sha256,versionId:x.versionId,expected:x.expected
   });
   ok(read?.verified===true&&read.sha256===x.sha256&&
    read.versionId===x.versionId&&read.productionAuthorized===false,
    'full remote anchor GET/HEAD verification rejected');
   entries.push({receipt:read.receipt,sha256:read.sha256,
    versionId:read.versionId});
  }
  return verifyR176AnchorChain({entries,checkpoint,bundleSha256,
   pinnedOperatorSpkiSha256,pinnedReviewerSpkiSha256,clock});
 }
 return Object.freeze({read,publicStatus:()=>({
  readOnlyByDefault:!allowRead,sourceAwsClientConfigured:false,
  productionAuthorized:false})});
}
