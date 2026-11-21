/** Operator-opt-in DNS pinned HTTPS, 3 anonymous requests, no deployment. */
import {createR187PinnedHttpsTransport} from '../r187/pinned-https.mjs';
import {createR186HttpsPreflight} from '../r186/https-preflight.mjs';
import {createR187TlsProof} from '../r187/tls-proof.mjs';
import {H40,H64,requireTrue,sealReceipt} from './common.mjs';
export async function readR190StagingHttps({
 hostname,commit,bundleSha256,runId,
 allowNetwork=false,resolveAddresses,httpsRequest,clock=()=>Date.now()
}={}){
 requireTrue(allowNetwork===true&&H40.test(commit||'')&&
  H64.test(bundleSha256||'')&&Number.isSafeInteger(runId)&&runId>=10000,
  'explicit read-only operator staging inspection required');
 const opts={hostname,allowNetwork:true,clock};
 if(resolveAddresses)opts.resolveAddresses=resolveAddresses;
 if(httpsRequest)opts.httpsRequest=httpsRequest;
 const transport=createR187PinnedHttpsTransport(opts);
 await transport.initialize();
 const probe=await createR186HttpsPreflight({hostname,
  fetcher:transport.fetcher,clock,allowNetwork:true,
  sourceMode:'OPERATOR_READONLY_UNATTESTED'}).inspect({commit,bundleSha256});
 const tls=createR187TlsProof({transportStatus:transport.publicStatus(),
  httpsProof:probe,commit,bundleSha256,runId,clock,
  sourceMode:'OPERATOR_READONLY_UNATTESTED'});
 return sealReceipt({schemaVersion:1,kind:'R190_TLS',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:'OPERATOR_READONLY_UNATTESTED',hostname,
  httpsEvidenceSha256:probe.evidenceSha256,
  tlsEvidenceSha256:tls.evidenceSha256,
  allReadOnlyHealthChecksPassed:probe.healthAndSecurityPassed,
  pinnedAddressCount:transport.publicStatus().pinnedAddressCount,
  externalTlsIdentityIndependentlyVerified:false,
  dnssecVerified:false,peerCertificateExternallyAudited:false,
  responseBodiesRetained:false,credentialsSent:false,
  decision:'NO_GO_EXTERNAL_TLS_IDENTITY_REVIEW_PENDING',
  observedAtMs:tls.observedAtMs,
  realPilotAuthorized:false,productionAuthorized:false});
}
