/** One anonymous TLS handshake to a pre-resolved public IPv4 staging endpoint.
 * Verify OS trust, exact hostname, validity and independent leaf SHA-256 pin.
 * Injected CI dial never attests external CA or live host identity. */
import {lookup} from 'node:dns/promises';
import {connect as tlsConnect} from 'node:tls';
import {createHash,X509Certificate} from 'node:crypto';
import {isR187PublicIPv4,validateR187DnsAnswers} from '../r187/pinned-https.mjs';
import {validateR186StagingHostname} from '../r186/https-preflight.mjs';
import {H40,H64,requireTrue,sealReceipt} from '../r190/common.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function networkDial(options){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const socket=tlsConnect(options);
  const finish=(err,value)=>{
   if(settled)return;
   settled=true;socket.destroy();
   if(err)reject(Error('R191: TLS handshake failed'));
   else resolve(value);
  };
  socket.setTimeout(7000);
  socket.once('timeout',()=>finish(Error('timeout')));
  socket.once('error',finish);
  socket.once('secureConnect',()=>{
   try{finish(null,{authorized:socket.authorized,
    peerCertificate:socket.getPeerCertificate(true)});}
   catch(e){finish(e);}
  });
 });
}
export async function inspectR191TlsCertificate({
 commit,bundleSha256,hostname,expectedLeafFingerprintSha256,
 resolveAddresses=h=>lookup(h,{all:true,verbatim:true}),
 dial=networkDial,clock=()=>Date.now(),
 allowNetwork=false,sourceMode='CI_FIXTURE'
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  H64.test(expectedLeafFingerprintSha256||'')&&
  ['CI_FIXTURE','OPERATOR_READONLY_UNATTESTED'].includes(sourceMode)&&
  typeof resolveAddresses==='function'&&typeof dial==='function'&&
  typeof clock==='function'&&allowNetwork===true,
  'explicit source-bound TLS inspection and separately pinned cert SHA required');
 validateR186StagingHostname(hostname);
 const began=clock();
 let answers;
 try{answers=await resolveAddresses(hostname);}
 catch{throw Error('R191: DNS unavailable');}
 const publicIps=validateR187DnsAnswers(answers);
 const ip=publicIps[0];
 requireTrue(isR187PublicIPv4(ip),'non-public DNS target forbidden');
 let observation;
 try{observation=await dial({host:ip,servername:hostname,port:443,
  rejectUnauthorized:true,timeout:7000,ALPNProtocols:['http/1.1']});}
 catch{throw Error('R191: TLS connection refused');}
 requireTrue(observation?.authorized===true&&
  Buffer.isBuffer(observation.peerCertificate?.raw)&&
  observation.peerCertificate.raw.length>=128&&
  observation.peerCertificate.raw.length<=16384,
  'TLS certificate chain or DER not accepted');
 const raw=observation.peerCertificate.raw;
 const leaf=new X509Certificate(raw);
 requireTrue(leaf.checkHost(hostname)===hostname,
  'leaf certificate not valid for staging hostname');
 const current=clock(),from=Date.parse(leaf.validFrom),to=Date.parse(leaf.validTo);
 requireTrue(Number.isSafeInteger(current)&&current>=began&&
  current-began<=15000&&Number.isFinite(from)&&Number.isFinite(to)&&
  from<=current&&current<to,
  'expired or future TLS leaf or stale observation');
 const fingerprint=sha(raw);
 requireTrue(fingerprint===expectedLeafFingerprintSha256,
  'TLS DER differs from external fingerprint pin');
 return sealReceipt({schemaVersion:1,kind:'R191_TLS',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode,hostname,leafFingerprintSha256:fingerprint,
  osTlsChainAccepted:true,leafHostnameAndValidityVerified:true,
  pinnedPublicIpv4Dns:true,pinnedAddressCount:publicIps.length,
  externalPinOwnershipIndependentlyEstablished:false,
  externalHostControlIndependentlyVerified:false,
  observedAtMs:current,expiresAtMs:Math.min(current+60000,to),
  decision:'NO_GO_INDEPENDENT_TLS_ORIGIN_CONFIRMATION_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
