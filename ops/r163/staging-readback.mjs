/**
 * R163 read-only HTTPS staging attestation probe, not a deployment agent.
 * Pinned hostname, CA, SPKI SHA256 and fresh nonce; no redirects or secrets.
 * An injected transport exists for unit tests and is never counted as real TLS.
 */
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {X509Certificate,createHash,timingSafeEqual,randomBytes} from 'node:crypto';

const fail=m=>{throw Error('R163 readback: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hex64=/^[a-f0-9]{64}$/;
const hash=s=>createHash('sha256').update(s).digest('hex');
const compare=(a,b)=>a.length===b.length&&timingSafeEqual(Buffer.from(a,'hex'),
 Buffer.from(b,'hex'));
export function r163SpkiFingerprint(certPem){
 const cert=new X509Certificate(certPem);
 return hash(cert.publicKey.export({type:'spki',format:'der'}));
}
async function secureRead({hostname,connectHost,port,caPem,expectedSpki,nonce,timeoutMs}){
 const reqOptions={
  protocol:'https:',hostname:connectHost,port,servername:hostname,method:'GET',
  path:'/.well-known/marcosa-stage.json',minVersion:'TLSv1.2',
  rejectUnauthorized:true,ca:caPem,agent:false,timeout:timeoutMs,
  headers:{Host:hostname,Accept:'application/json',
   'Cache-Control':'no-store','x-marcosa-probe-nonce':nonce},
  checkServerIdentity:(name,peer)=>{
   const error=checkServerIdentity(hostname,peer);
   if(error)return error;
   try{
    const actual=hash(new X509Certificate(peer.raw).publicKey.export({
     type:'spki',format:'der'}));
    if(!compare(expectedSpki,actual))return Error('TLS SPKI pin mismatch');
   }catch{return Error('Malformed peer signing certificate');}
   return undefined;
  }
 };
 return await new Promise((resolve,reject)=>{
  const req=httpsRequest(reqOptions,res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{
    size+=chunk.length;
    if(size>4096){req.destroy(Error('Oversized stage readback'));return;}
    chunks.push(chunk);
   });
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,
    body:Buffer.concat(chunks)}));
  });
  req.on('timeout',()=>req.destroy(Error('Stage readback timeout')));
  req.on('error',reject);req.end();
 });
}
export function createR163StagingReadback({
 origin,caPem,expectedSpki,clock=()=>Date.now(),
 timeoutMs=3500,transport,ciLoopback=false,connectHost,port=443
}={}){
 let parsed;
 try{parsed=new URL(origin);}catch{fail('absolute HTTPS origin required');}
 ok(parsed.protocol==='https:'&&parsed.pathname==='/'&&
  !parsed.search&&!parsed.hash&&!parsed.username&&!parsed.password&&
  !parsed.port&&parsed.origin===origin.replace(/\/$/,''),
  'exact HTTPS root origin required');
 const hostname=parsed.hostname;
 ok(/^[a-z0-9][a-z0-9.-]{3,190}$/i.test(hostname)&&
  !['localhost','127.0.0.1','0.0.0.0'].includes(hostname)&&
  !hostname.endsWith('.local'),'pinned nonlocal staging hostname required');
 ok(typeof caPem==='string'&&caPem.length>=200&&caPem.length<=16000,
  'trusted CA PEM required');
 let ca;
 try{ca=new X509Certificate(caPem);}catch{fail('invalid trusted CA');}
 ok(Date.parse(ca.validFrom)<=clock()&&Date.parse(ca.validTo)>clock(),
  'expired CA forbidden');
 ok(typeof expectedSpki==='string'&&hex64.test(expectedSpki),
  'independently pinned TLS SPKI fingerprint required');
 ok(Number.isInteger(timeoutMs)&&timeoutMs>=500&&timeoutMs<=7000,
  'bounded timeout required');
 ok(typeof clock==='function','valid clock required');
 const fixture=ciLoopback===true&&
  process.env.GITHUB_ACTIONS==='true'&&
  process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion';
 const dest=connectHost??hostname;
 ok((dest===hostname&&port===443)||
  (fixture&&dest==='127.0.0.1'&&Number.isInteger(port)&&port>0&&port<=65535),
  'external staging cannot redirect to alternate hosts or ports');
 ok(transport===undefined||typeof transport==='function',
  'trusted request transport required');
 const read=transport||secureRead;
 return Object.freeze({
  async probe({commit,bundleSha256}={}){
   ok(typeof commit==='string'&&/^[a-f0-9]{40}$/.test(commit)&&
    typeof bundleSha256==='string'&&hex64.test(bundleSha256),
    'expected source SHA and full bundle digest required');
   const nonce=randomBytes(16).toString('hex');
   let response;
   try{response=await read({hostname,connectHost:dest,port,caPem,
    expectedSpki,nonce,timeoutMs});}
   catch{fail('HTTPS staging readback unavailable or TLS trust rejected');}
   ok(response?.status===200&&
    response.headers?.['content-type']==='application/json'&&
    /(?:^|,)\s*no-store(?:,|$)/i.test(response.headers?.['cache-control']||'')&&
    !response.headers?.location,'HTTPS staging returned unsafe status or headers');
   ok(Buffer.isBuffer(response.body)&&response.body.length>25&&
    response.body.length<=2048,'readback response bounded and non-empty');
   let proof;
   try{proof=JSON.parse(response.body.toString('utf8'));}
   catch{fail('staging response not JSON');}
   ok(proof&&typeof proof==='object'&&!Array.isArray(proof)&&
    Object.keys(proof).sort().join(',')===
     'bundleSha256,commit,nonce,productionReady,schemaVersion,service,stage'&&
    proof.schemaVersion===1&&proof.service==='marcosa-fusion'&&
    proof.stage==='isolated-staging'&&proof.productionReady===false&&
    proof.commit===commit&&proof.bundleSha256===bundleSha256&&
    proof.nonce===nonce,'staging readback not tied to fresh source evidence');
   return Object.freeze({
    readbackMatched:true,stage:'isolated-staging',
    pinnedTlsTransportUsed:transport===undefined,
    syntheticCiLoopback:fixture,commit,bundleSha256,
    observedAtMs:clock(),productionAuthorized:false
   });
  }
 });
}
