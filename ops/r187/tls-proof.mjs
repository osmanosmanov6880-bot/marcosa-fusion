/**
 * R187 normalized DNS-pinned transport observation. It describes executed
 * HTTPS checks and pinning of DNS in a test/operator run, NOT DNSSEC,
 * certificate transparency or independent TLS identity attestation.
 */
import {createHash} from 'node:crypto';
import {validateR186StagingHostname} from '../r186/https-preflight.mjs';
const fail=m=>{throw Error('R187 TLS receipt: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function createR187TlsProof({transportStatus,httpsProof,
 commit,bundleSha256,runId,clock=()=>Date.now(),
 sourceMode='CI_SYNTHETIC'}={}){
 ok(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  Number.isSafeInteger(runId)&&runId>=10000&&
  ['CI_SYNTHETIC','OPERATOR_READONLY_UNATTESTED'].includes(sourceMode)&&
  typeof clock==='function'&&
  transportStatus&&Object.getPrototypeOf(transportStatus)===Object.prototype&&
  transportStatus.readOnly===true&&
  transportStatus.enabled===true&&
  Number.isSafeInteger(transportStatus.pinnedAddressCount)&&
  transportStatus.pinnedAddressCount>=1&&
  transportStatus.pinnedAddressCount<=8&&
  H64.test(transportStatus.pinnedAddressSetSha256||'')&&
  transportStatus.requestCount===3&&
  transportStatus.productionAuthorized===false&&
  transportStatus.realPilotAuthorized===false&&
  httpsProof?.sourceCommit===commit&&
  httpsProof.sourceBundleSha256===bundleSha256&&
  httpsProof.sourceMode===sourceMode&&
  validateR186StagingHostname(httpsProof.hostname)===
   transportStatus.hostname&&
  httpsProof.scope==='explicit-staging-readonly-health'&&
  httpsProof.readOnlyRequests===3&&
  httpsProof.checks?.length===3&&
  httpsProof.noRedirectsFollowed===true&&
  httpsProof.noCredentialsSent===true&&
  httpsProof.responseBodiesRetained===false&&
  httpsProof.actualDeploymentAttempted===false&&
  httpsProof.productionAuthorized===false&&
  H64.test(httpsProof.evidenceSha256||''),
  'exact three source-bound DNS-pinned HTTPS observations required');
 const {evidenceSha256,...rest}=httpsProof;
 ok(sha(rest)===evidenceSha256,
  'R186 HTTPS receipt hash must verify');
 const at=clock();
 ok(Number.isSafeInteger(at)&&at>=httpsProof.observedAtMs&&
  at<=httpsProof.expiresAtMs,
  'source-bound TLS transport receipt expired');
 const obj={
  schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
  runId,sourceMode,stagingHostname:httpsProof.hostname,
  httpsEvidenceSha256:jsonHash(rest),
  pinnedAddressSetSha256:transportStatus.pinnedAddressSetSha256,
  acceptedGlobalIpv4Addresses:transportStatus.pinnedAddressCount,
  readOnlyPinnedRequests:3,
  threeHttpsHealthChecksPassed:httpsProof.healthAndSecurityPassed,
  dnssecVerified:false,
  externalTlsIdentityIndependentlyAttested:false,
  peerCertificateIndependentlyReviewed:false,
  ipAddressesPublished:false,
  realPilotAuthorized:false,productionAuthorized:false,
  observedAtMs:at,
  decision:'NO_GO_TLS_IDENTITY_INDEPENDENTLY_UNVERIFIED'
 };
 return Object.freeze({...obj,evidenceSha256:sha(obj)});
}
function jsonHash(x){return sha(x);}
