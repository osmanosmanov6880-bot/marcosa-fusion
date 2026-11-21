/**
 * R186 read-only HTTPS staging edge diagnostics.
 *
 * Explicit operator-pinned staging FQDN; only 3 immutable GET/HEAD routes,
 * HTTPS 443, no cookie/auth/header passthrough, redirects forbidden.
 * No body data, PII, origin IP, credentials or certificate details in report.
 * Synthetic CI transport is NEVER a real TLS or staging attestation.
 */
import {createHash} from 'node:crypto';
const fail=m=>{throw Error('R186 HTTPS preflight: '+m);};
const ok=(x,m)=>{if(!x)fail(m);};
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const paths=Object.freeze([
 {name:'HEALTH',method:'GET',path:'/health',expected:'ok'},
 {name:'READY',method:'GET',path:'/ready',expected:'ready'},
 {name:'SECURITY_HEADERS',method:'HEAD',path:'/',expected:null}
]);
export const R186_STAGING_PROBES=paths;
const mode=x=>['CI_SYNTHETIC','OPERATOR_READONLY_UNATTESTED'].includes(x);
export function validateR186StagingHostname(hostname){
 ok(typeof hostname==='string'&&hostname.length>=15&&hostname.length<=190&&
  hostname===hostname.toLowerCase()&&
  /^staging\.[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}$/.test(hostname)&&
  !hostname.includes('..')&&!hostname.includes('--')&&
  !/\.(?:local|localhost|internal|test|invalid|onion)$/.test(hostname)&&
  hostname.split('.').every(x=>x.length>0&&x.length<=63),
  'explicit pinned public staging hostname is required; private/IP/url forbidden');
 return hostname;
}
export function createR186HttpsPreflight({
 hostname,fetcher=globalThis.fetch,clock=()=>Date.now(),
 allowNetwork=false,sourceMode='CI_SYNTHETIC'
}={}){
 validateR186StagingHostname(hostname);
 ok(typeof fetcher==='function'&&typeof clock==='function'&&
  mode(sourceMode),'read-only HTTPS transport and source mode required');
 const origin='https://'+hostname;
 async function probe(p){
  let response;
  const url=origin+p.path;
  try{
   ok(allowNetwork===true,'explicit HTTPS read-only opt-in required');
   response=await fetcher(url,{
    method:p.method,redirect:'error',cache:'no-store',
    credentials:'omit',signal:AbortSignal.timeout(7000),
    headers:{Accept:p.method==='HEAD'?'*/*':'application/json',
     'Cache-Control':'no-store',
     'User-Agent':'marcosa-r186-readonly-health'}
   });
  }catch{return Object.freeze({name:p.name,
   passed:false,reason:'UNAVAILABLE_OR_REDIRECT'});}
  const status=response?.status;
  if(!Number.isSafeInteger(status)||status<100||status>599||
   response.redirected===true||
   (typeof response.url==='string'&&response.url!==url))
   return Object.freeze({name:p.name,passed:false,reason:'UNTRUSTED_RESPONSE'});
  if(status!==200)
   return Object.freeze({name:p.name,passed:false,
    reason:status>=300&&status<=399?'REDIRECT_BLOCKED':'HTTP_NOT_OK'});
  const headers=response?.headers;
  const get=n=>String(headers?.get?.(n)||'').trim().toLowerCase();
  const nosniff=get('x-content-type-options')==='nosniff';
  const hsts=get('strict-transport-security');
  const match=/(?:^|;)\s*max-age=(\d{1,12})\s*(?:;|$)/.exec(hsts);
  const strongTls=!!match&&Number(match[1])>=31536000;
  const noStore=get('cache-control').split(',')
   .some(x=>x.trim()==='no-store');
  const secure=nosniff&&strongTls&&noStore;
  if(p.method==='HEAD')
   return Object.freeze({name:p.name,passed:secure,
    reason:secure?'OK':'SECURITY_HEADERS_MISSING'});
  if(!/application\/json(?:;|$)/.test(get('content-type')))
   return Object.freeze({name:p.name,passed:false,reason:'NON_JSON_CONTENT'});
  let body;
  try{
   const raw=await response.text();
   ok(typeof raw==='string'&&raw.length>=2&&raw.length<=2048,
    'bounded anonymous health response body required');
   body=JSON.parse(raw);
  }catch{return Object.freeze({name:p.name,passed:false,
   reason:'INVALID_OR_OVERSIZED_JSON'});}
  const statusOk=body&&Object.getPrototypeOf(body)===Object.prototype&&
   body.status===p.expected&&
   !('customer' in body)&&!('token' in body)&&!('secret' in body);
  const passed=statusOk&&secure;
  return Object.freeze({name:p.name,passed:!!passed,
   reason:passed?'OK':statusOk?'SECURITY_HEADERS_MISSING':
    'UNEXPECTED_HEALTH_SCHEMA'});
 }
 async function inspect({commit,bundleSha256}={}){
  ok(H40.test(commit||'')&&H64.test(bundleSha256||''),
   'exact source SHA/bundle required');
  const observedAtMs=clock();
  ok(Number.isSafeInteger(observedAtMs)&&observedAtMs>0,
   'trusted timestamp required');
  const checks=[];
  // Sequential; no scanning or parallel bursts against a staging origin.
  for(const p of paths)checks.push(await probe(p));
  const finished=clock();
  ok(Number.isSafeInteger(finished)&&finished>=observedAtMs&&
   finished-observedAtMs<=30000,
   'read-only health inspection exceeded bounded window');
  const report={
   schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
   sourceMode,hostname,scope:'explicit-staging-readonly-health',
   readOnlyRequests:3,checks,
   healthAndSecurityPassed:checks.every(x=>x.passed===true),
   noRedirectsFollowed:true,noCredentialsSent:true,
   responseBodiesRetained:false,customerRecordsRead:false,
   actualDeploymentAttempted:false,
   externalTlsIdentityIndependentlyAttested:false,
   observedAtMs:finished,expiresAtMs:finished+60000,
   realPilotAuthorized:false,productionAuthorized:false
  };
  return Object.freeze({...report,evidenceSha256:sha(report)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  enabled:allowNetwork,readOnly:true,hostname,productionAuthorized:false})});
}
