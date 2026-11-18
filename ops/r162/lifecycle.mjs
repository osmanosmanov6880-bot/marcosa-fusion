/**
 * R162: atomic, operator-started STAGING lifecycle, local sockets only.
 * Does not connect to production, set up DNS, deploy to VPS, or start itself.
 */
import {X509Certificate} from 'node:crypto';
import {assembleSealedR161Staging} from '../r161/sealed-config.mjs';
import {createR161TlsIngress} from '../r161/tls-ingress.mjs';

const fail=m=>{throw Error('R162 lifecycle: '+m);};
const check=(v,m)=>{if(!v)fail(m);};
const local={host:'127.0.0.1',port:0};
export function createR162StagingLifecycle({runtime,control,ingressFactory}={}){
 check(runtime&&typeof runtime.listen==='function'&&typeof runtime.stop==='function'&&
  typeof runtime.status==='function','trusted command runtime required');
 check(control&&typeof control.listen==='function'&&typeof control.close==='function',
  'trusted operator control required');
 check(typeof ingressFactory==='function','operator-provided TLS ingress required');
 let state='cold',ingress=null,stopping=null;
 const counts={starts:0,rollbacks:0,drains:0};
 const publicState=()=>Object.freeze({state,stagingOnly:true,
  productionReady:false,externalDeliveryEnabled:false,paymentsEnabled:false,
  ...counts});
 async function unwind(){
  const errors=[];
  if(ingress){try{await ingress.close();}catch{errors.push('ingress');}ingress=null;}
  try{await control.close();}catch{errors.push('control');}
  try{await runtime.stop();}catch{errors.push('runtime');}
  return errors;
 }
 async function stop(){
  if(stopping)return stopping;
  if(state==='stopped')return publicState();
  state='draining';counts.drains++;
  stopping=(async()=>{
   const errors=await unwind();
   state='stopped';
   if(errors.length)fail('shutdown incomplete: '+errors.join(','));
   return publicState();
  })();
  return stopping;
 }
 return Object.freeze({
  async start(){
   check(state==='cold','service can only start once');
   state='starting';
   try{
    const gateway=await runtime.listen(local);
    check(gateway&&gateway.host==='127.0.0.1'&&
     Number.isInteger(gateway.port)&&gateway.port>0&&gateway.port<=65535,
     'loopback command listener not proven');
    const ready=runtime.status();
    check(ready?.ready===true&&ready?.productionReady===false,
     'signed Auth and PostgreSQL readiness not proven');
    const controlAddr=await control.listen(local);
    check(controlAddr?.host==='127.0.0.1'&&Number.isInteger(controlAddr.port)&&
     controlAddr.port>0,'loopback control listener not proven');
    ingress=await ingressFactory({upstreamPort:gateway.port});
    check(ingress&&typeof ingress.listen==='function'&&typeof ingress.close==='function',
     'TLS ingress component contract invalid');
    const publicAddr=await ingress.listen(local);
    check(publicAddr?.host==='127.0.0.1'&&Number.isInteger(publicAddr.port)&&
     publicAddr.port>0,'TLS ingress must remain on loopback');
    check(runtime.status()?.ready===true,'dependencies degraded during boot');
    state='ready';counts.starts++;
    return Object.freeze({state,command:gateway.port,control:controlAddr.port,
     https:publicAddr.port,host:'127.0.0.1',productionReady:false});
   }catch{
    counts.rollbacks++;state='rolling_back';
    await unwind();
    state='failed';
    fail('staging launch rejected; listener rollback attempted');
   }
  },
  stop,status:publicState
 });
}
/** Strong hostname check before assembling a real process, but no listen. */
export async function assembleR162OperatorBoot({
 secretsRoot,hostname,certPem,keyPem,jwksFetch
}={}){
 check(typeof hostname==='string'&&/^[a-z0-9.-]{4,190}$/i.test(hostname),
  'pinned staging hostname required');
 check(typeof certPem==='string'&&typeof keyPem==='string',
  'operator-supplied TLS certificate and key required');
 let cert;
 try{cert=new X509Certificate(certPem);}catch{fail('invalid TLS X509 certificate');}
 const now=Date.now();
 check(Date.parse(cert.validFrom)<=now&&Date.parse(cert.validTo)>now&&
  cert.checkHost(hostname)===hostname,
  'staging TLS certificate hostname and validity required');
 const bundle=await assembleSealedR161Staging({secretsRoot,jwksFetch});
 check(bundle.publicMetadata.stage==='staging','operator staging identity required');
 const expectedOrigin='https://'+hostname;
 check(bundle.runtime.status().productionReady===false&&
  bundle.publicMetadata.productionReady===false,
  'only nonproduction runtime may be started');
 // The operator must separately verify certificate/private key, pin CA,
 // approve the destination and verify external staging configuration.
 return createR162StagingLifecycle({
  runtime:bundle.runtime,control:bundle.control,
  ingressFactory:({upstreamPort})=>createR161TlsIngress({
   certPem,keyPem,hostname,upstreamPort
  })
 });
}
