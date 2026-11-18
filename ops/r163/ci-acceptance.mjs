/**
 * R163 disposable CI acceptance: independently re-check local bytes, create
 * synthetic Ed25519 key-pair separation and real loopback HTTPS SPKI readback.
 * Outputs are explicitly labeled CI-only and never authorize live staging.
 */
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:https';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {buildR163Bundle,verifyR163Bundle} from './repro-bundle.mjs';
import {createR163ReviewChallenge,reviewerKeyFingerprint,
 r163ReviewCanonicalBytes,verifyR163ReviewAttestation} from './review-attestation.mjs';
import {createR163StagingReadback,r163SpkiFingerprint} from './staging-readback.mjs';
import {createR163SloMonitor} from './slo-monitor.mjs';
import {evaluateR163StagingCandidate} from './release-gate.mjs';
const repo='osmanosmanov6880-bot/marcosa-fusion';
const guard=(x,m)=>{if(!x)throw Error('R163 CI: '+m);};
guard(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY===repo&&
 typeof process.env.RUNNER_TEMP==='string'&&
 /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''),
 'authorized isolated checkout required');
const commit=process.env.GITHUB_SHA,root=process.cwd(),time=Date.now();
const dir=join(process.env.RUNNER_TEMP,'r163-artifact'),tmp=await mkdtemp(join(process.env.RUNNER_TEMP,'r163-https-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
let server=null;
try{
 await mkdir(dir,{recursive:false,mode:0o700});
 const packaged=await buildR163Bundle({root,commit});
 const checked=await verifyR163Bundle({root,commit,bytes:packaged.bytes,
  expectedSha256:packaged.sha256});
 guard(checked.exactSourceBytes&&checked.productionAuthorized===false,
  'local bundle verification failed');
 const builder=generateKeyPairSync('ed25519'),reviewer=generateKeyPairSync('ed25519');
 const challenge=createR163ReviewChallenge({commit,
  bundleSha256:packaged.sha256,clock:()=>time});
 const signature=sign(null,r163ReviewCanonicalBytes(challenge),
  reviewer.privateKey).toString('base64url');
 const review=verifyR163ReviewAttestation({challenge,signature,
  reviewerPublicKey:reviewer.publicKey,
  reviewerPin:reviewerKeyFingerprint(reviewer.publicKey),
  builderPin:reviewerKeyFingerprint(builder.publicKey),
  commit,bundleSha256:packaged.sha256,clock:()=>time});
 guard(review.humanIndependenceEstablished===false&&
  review.productionAuthorized===false,'synthetic reviewer cannot approve release');
 const host='staging.r163.example.invalid',certPath=join(tmp,'server-cert.pem'),keyPath=join(tmp,'server-key.pem');
 const p=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
  '-keyout',keyPath,'-out',certPath,'-days','2',
  '-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host],
  {encoding:'utf8',timeout:15000});
 guard(p.status===0,'temporary loopback TLS fixture unavailable');
 const cert=await readFile(certPath,'utf8'),key=await readFile(keyPath,'utf8');
 let breakMode='none';
 server=createServer({cert,key,minVersion:'TLSv1.2'},(req,res)=>{
  if(req.method!=='GET'||req.url!=='/.well-known/marcosa-stage.json'){
   res.writeHead(404);res.end();return;
  }
  if(breakMode==='redirect'){res.writeHead(302,{Location:'https://evil.invalid'});res.end();return;}
  const nonce=breakMode==='stale'?'e'.repeat(32):req.headers['x-marcosa-probe-nonce'];
  const payload={schemaVersion:1,service:'marcosa-fusion',
   stage:'isolated-staging',commit,bundleSha256:packaged.sha256,
   nonce,productionReady:false};
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(payload));
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
   server.removeListener('error',reject);resolve();
  });
 });
 const makeProbe=()=>createR163StagingReadback({
  origin:'https://'+host,caPem:cert,expectedSpki:r163SpkiFingerprint(cert),
  ciLoopback:true,connectHost:'127.0.0.1',port:server.address().port
 });
 const readback=await makeProbe().probe({commit,bundleSha256:packaged.sha256});
 guard(readback.pinnedTlsTransportUsed===true&&readback.syntheticCiLoopback===true,
  'real local TLS and separate production origin contract required');
 breakMode='stale';
 let staleRejected=false;
 try{await makeProbe().probe({commit,bundleSha256:packaged.sha256});}
 catch{staleRejected=true;}
 guard(staleRejected,'cached nonce replay was accepted');
 breakMode='redirect';
 let redirectRejected=false;
 try{await makeProbe().probe({commit,bundleSha256:packaged.sha256});}
 catch{redirectRejected=true;}
 guard(redirectRejected,'HTTPS redirect was followed');
 breakMode='none';
 let now=Date.now();
 const monitor=createR163SloMonitor({clock:()=>now,
  windowSize:5,requiredHealthyWindows:3,observationTtlMs:60000});
 for(let i=0;i<15;i++){
  now+=1;monitor.recordProbe({statusCode:200,latencyMs:65,
   tlsPinned:readback.pinnedTlsTransportUsed,
   readbackMatched:readback.readbackMatched});
 }
 const slo=monitor.status();
 guard(slo.ready,'three independent canary windows required');
 const restore={passed:true,scope:'synthetic-ci',commit,
  bundleSha256:packaged.sha256,observedAtMs:now,productionAuthorized:false};
 const gate=evaluateR163StagingCandidate({now,commit,bundleSha256:packaged.sha256,
  bundle:checked,review,readback,slo,restore});
 guard(gate.decision==='CI_SIMULATION_COMPLETE'&&
  gate.productionAuthorized===false&&gate.manualOperatorReviewRequired===true,
  'simulated CI proof must not authorize external staging');
 const out={
  schemaVersion:1,repository:repo,commit,
  bundleSha256:packaged.sha256,
  decision:gate.decision,
  sourceCount:packaged.sourceCount,
  independentlyReviewed:false,
  syntheticCiLoopback:true,
  syntheticRestoreProof:true,
  tlsSpkiReadbackVerified:true,
  ephemeralReviewerSignatureVerified:true,
  freshNonceReplayRejected:true,
  redirectRejected:true,
  productionAuthorized:false,
  realSupabaseUsed:false
 };
 const reportBytes=Buffer.from(JSON.stringify(out,null,2)+'\n','utf8');
 const bundleFile=join(dir,'source.bundle.json'),reportFile=join(dir,'ci-report.json');
 await writeFile(bundleFile,packaged.bytes,{flag:'wx',mode:0o600});
 await writeFile(reportFile,reportBytes,{flag:'wx',mode:0o600});
 const readbackBytes=await readFile(bundleFile);
 guard(readbackBytes.equals(packaged.bytes)&&
  (await readFile(reportFile)).equals(reportBytes),'CI evidence lost on disk');
 const digest=Buffer.from(JSON.stringify({
  schemaVersion:1,repository:repo,commit,
  bundleSha256:sha(packaged.bytes),reportSha256:sha(reportBytes),
  productionAuthorized:false
 },null,2)+'\n');
 await writeFile(join(dir,'manifest.json'),digest,{flag:'wx',mode:0o600});
 console.log('R163_LOCAL_SOURCE_BUNDLE_REPRODUCIBLE=PASS');
 console.log('R163_SYNTHETIC_ED25519_AND_REAL_LOOPBACK_TLS_SPKI=PASS');
 console.log('R163_NONCE_REDIRECT_CANARY_FAIL_CLOSED=PASS');
 console.log('R163_CI_SIMULATION_NOT_RELEASE_APPROVAL=PASS');
 console.log('R163_BUNDLE_SHA256='+packaged.sha256);
}finally{
 if(server)await new Promise(resolve=>server.close(()=>resolve()));
 await rm(tmp,{recursive:true,force:true});
}
