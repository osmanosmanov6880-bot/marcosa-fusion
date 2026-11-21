import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createR187PinnedHttpsTransport,isR187PublicIPv4,
 validateR187DnsAnswers} from '../r187/pinned-https.mjs';
import {createR186HttpsPreflight} from '../r186/https-preflight.mjs';
import {createR187TlsProof} from '../r187/tls-proof.mjs';
import {createR187DualAttestation,r187AttestationMessage}
 from '../r187/dual-attestation.mjs';
import {r187SyntheticRetentionRows,createR187PrivacyRetention}
 from '../r187/privacy-retention.mjs';
import {createR187StagingGate} from '../r187/staging-gate.mjs';
import {r187ObservationSql,createR187ObservationLedger}
 from '../r187/observation-ledger.mjs';
const sha=x=>createHash('sha256').update(
 typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const now=1800000000000,clock=()=>now;
const commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 runId=123456789,nonce='c'.repeat(32),
 stage='staging.marcosa.example.com';
const ancestorRaw={
 schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
 runId,sequence:3,nonce,r185EvidenceSha256:'1'.repeat(64),
 sourceMode:'CI_SYNTHETIC',stagingHostname:stage,
 decision:'NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING',
 realPilotAuthorized:false,productionAuthorized:false
};
const ancestor={...ancestorRaw,evidenceSha256:sha(ancestorRaw)};
const nativeWitness={
 runId,sequence:3,nonce,sourceCommit:commit,
 r186EvidenceSha256:ancestor.evidenceSha256,
 decision:ancestor.decision,productionAuthorized:false
};
function transport({dns=[{address:'93.184.216.34',family:4}],
 badHeaders=false,alterDns=false}={}){
 let calls=0,received=[];
 const mockRequest=(url,options,handler)=>{
  calls++;received.push({url,options});
  const req=new EventEmitter();
  req.destroy=()=>req.emit('error',new Error('abort'));
  req.end=()=>queueMicrotask(()=>{
   const response=new PassThrough();
   response.statusCode=200;
   response.headers={
    'content-type':'application/json',
    'x-content-type-options':badHeaders?'invalid':'nosniff',
    'cache-control':'private, no-store',
    'strict-transport-security':'max-age=63072000; includeSubDomains'
   };
   handler(response);
   const status=url.endsWith('/health')?'ok':'ready';
   response.end(options.method==='HEAD'?'':JSON.stringify({status}));
  });
  return req;
 };
 const pinned=createR187PinnedHttpsTransport({
  hostname:stage,resolveAddresses:async()=>alterDns?
   [{address:'10.0.0.1',family:4}]:dns,
  httpsRequest:mockRequest,clock,allowNetwork:true
 });
 return{pinned,received:()=>received,calls:()=>calls};
}
async function goodHttps(){
 const m=transport();
 await m.pinned.initialize();
 const h=await createR186HttpsPreflight({
  hostname:stage,fetcher:m.pinned.fetcher,clock,
  sourceMode:'CI_SYNTHETIC',allowNetwork:true
 }).inspect({commit,bundleSha256});
 assert.equal(h.healthAndSecurityPassed,true);
 return{httpsProof:h,tls:createR187TlsProof({
  transportStatus:m.pinned.publicStatus(),httpsProof:h,
  commit,bundleSha256,runId,clock
 }),transport:m};
}
function signs(override={}){
 const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
 const registry=[{role:'PR_REVIEW',signerId:2002,
  publicKeySpkiBase64:a.publicKey.export({format:'der',type:'spki'})
   .toString('base64')},
  {role:'SECURITY_REVIEW',signerId:3003,
   publicKeySpkiBase64:b.publicKey.export({format:'der',type:'spki'})
    .toString('base64')}];
 const packet={
  audience:'R187_READONLY_REVIEW_NOT_DEPLOY',sourceCommit:commit,
  bundleSha256,
  githubEvidenceSha256:'2'.repeat(64),
  httpsEvidenceSha256:'3'.repeat(64),
  issuedAtMs:now-5000,runId,nonce:'f'.repeat(32),
  ...override
 };
 const message=r187AttestationMessage(packet);
 const signatures=[
  {role:'PR_REVIEW',signerId:2002,
   signatureBase64url:sign(null,message,a.privateKey).toString('base64url')},
  {role:'SECURITY_REVIEW',signerId:3003,
   signatureBase64url:sign(null,message,b.privateKey).toString('base64url')}
 ];
 const verifier=createR187DualAttestation({
  expectedSigners:registry,clock,allowVerify:true
 });
 return{registry,packet,signatures,verifier,
  proof:verifier.inspect({packet,signatures})};
}
async function retention({deleteAll=false,removeOne=false,
 changedAncestor=false,opened=false}={}){
 let rows=r187SyntheticRetentionRows({commit,runId})
  .map(x=>({...x}));
 let reads=0;
 const model=createR187PrivacyRetention({
  readR186Hold:async()=>{
   reads++;return changedAncestor&&reads>=2?
    {...nativeWitness,sequence:4}:nativeWitness;
  },
  quarantine:{status:async()=>({closed:!opened,generation:5})},
  readRows:async()=>rows.map(x=>({...x})),
  deleteExpired:async()=>{
   if(removeOne){rows=rows.filter(x=>x.ordinal!==1);return 1;}
   const n=deleteAll?12:rows.filter(x=>x.expired).length;
   rows=deleteAll?[]:rows.filter(x=>!x.expired);
   return n;
  },clock,allowDisposableWrite:true
 });
 return model.inspect({commit,bundleSha256,runId});
}
async function allGood(){
 const h=await goodHttps();
 const s=signs({
  httpsEvidenceSha256:h.httpsProof.evidenceSha256
 });
 const rp=await retention();
 const r186Report={
  schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
  r185Report:{hold:{evidenceSha256:'1'.repeat(64)}},
  assessment:ancestor,
  githubProof:{evidenceSha256:s.packet.githubEvidenceSha256},
  httpsProof:h.httpsProof,
  realPg17RestoreRlsAndAudit:true,
  realPg17ReplayDenied:true,
  syntheticGithubApiOnly:true,
  syntheticHttpsTransportOnly:true,
  realGithubHumanApprovalsVerified:false,
  realHttpsTlsIndependentlyAttested:false,
  realAwsEffectiveRightsVerified:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 return{h,s,rp,r186Report};
}
async function staged(opts={}){
 const f=await allGood();
 let reads=0,guards=0;
 const g=createR187StagingGate({
  readR186Hold:async()=>{
   reads++;return opts.race&&reads>1?
    {...nativeWitness,sequence:4}:nativeWitness;
  },
  quarantine:{status:async()=>{
   guards++;return{closed:!opts.open,
    generation:opts.generationJump&&guards>1?6:5};
  }},
  verifyDualAttestation:args=>f.s.verifier.inspect(args),
  clock,allowInspect:true
 });
 return g.inspect({commit,bundleSha256,r186Report:f.r186Report,
  retentionProof:opts.fakeRetention?{
   ...f.rp,liveRetentionPolicyEnforced:true
  }:f.rp,
  dualAttestationProof:opts.forgedDual?{
   ...f.s.proof,cryptographicSignaturesValid:false
  }:f.s.proof,
  dualPacket:f.s.packet,dualSignatures:opts.corruptSignature?[
   {...f.s.signatures[0],signatureBase64url:
    'A'.repeat(86)},f.s.signatures[1]
  ]:f.s.signatures,
  tlsProof:opts.fakeTls?{
   ...f.h.tls,dnssecVerified:true
  }:f.h.tls});
}
test('R187 blocks private, loopback, reserved and mixed DNS before any HTTPS request',async()=>{
 for(const x of ['0.0.0.1','10.1.2.3','100.64.0.10',
  '127.0.0.1','169.254.169.254','172.17.0.1',
  '192.168.1.1','198.51.100.9','203.0.113.1','224.1.0.1','::1'])
 assert.equal(isR187PublicIPv4(x),false,x);
 assert.equal(isR187PublicIPv4('93.184.216.34'),true);
 for(const rows of [[{address:'10.0.0.1',family:4}],
  [{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}],
  [{address:'2001:4860:4860::8888',family:6}]])
 assert.throws(()=>validateR187DnsAnswers(rows),
  /R187 pinned HTTPS/);
 const bad=transport({alterDns:true});
 await assert.rejects(bad.pinned.initialize(),/R187 pinned HTTPS/);
 assert.equal(bad.calls(),0);
 const ok=await goodHttps();
 assert.equal(ok.transport.calls(),3);
 assert.equal(ok.tls.readOnlyPinnedRequests,3);
 assert.equal(ok.tls.externalTlsIdentityIndependentlyAttested,false);
 await assert.rejects(ok.transport.pinned.fetcher('https://'+stage+'/admin',{
  method:'GET',redirect:'error',credentials:'omit'
 }),/R187 pinned HTTPS/);
 await assert.rejects(ok.transport.pinned.fetcher('https://'+stage+'/ready',{
  method:'POST',redirect:'error',credentials:'omit'
 }),/R187 pinned HTTPS/);
 assert.equal(ok.transport.calls(),3);
 const wrong=transport({badHeaders:true});
 await wrong.pinned.initialize();
 const h=await createR186HttpsPreflight({hostname:stage,
  fetcher:wrong.pinned.fetcher,clock,allowNetwork:true
 }).inspect({commit,bundleSha256});
 assert.equal(h.healthAndSecurityPassed,false);
});
test('R187 two independent Ed25519 signers verify domain separated source-bound packet only',()=>{
 const g=signs();
 assert.equal(g.proof.signers.length,2);
 assert.equal(g.proof.cryptographicSignaturesValid,true);
 assert.equal(g.proof.independentHumanIdentityEstablished,false);
 assert.equal(g.proof.productionAuthorized,false);
 assert.throws(()=>createR187DualAttestation({
  expectedSigners:[g.registry[0],g.registry[0]],clock,allowVerify:true
 }),/R187 attestation/);
 assert.throws(()=>g.verifier.inspect({packet:{...g.packet,
  issuedAtMs:now-120000},signatures:g.signatures}),
 /R187 attestation/);
 assert.throws(()=>g.verifier.inspect({packet:{...g.packet,
  sourceCommit:'b'.repeat(40)},signatures:g.signatures}),
 /R187 attestation/);
 assert.throws(()=>g.verifier.inspect({packet:g.packet,
  signatures:[g.signatures[0],g.signatures[0]]}),
 /R187 attestation/);
 assert.throws(()=>g.verifier.inspect({packet:g.packet,
  signatures:[g.signatures[0],{
   ...g.signatures[1],signatureBase64url:
   'A'.repeat(86)}]}),/R187 attestation/);
});
test('R187 disposable PG17 retention contract requires exactly 4 purged, 8 retained, immutable source',async()=>{
 const p=await retention();
 assert.equal(p.syntheticRowsBefore,12);
 assert.equal(p.syntheticExpiredRowsDeleted,4);
 assert.equal(p.syntheticActiveRowsRemaining,8);
 assert.equal(p.rawCustomerDataProcessed,false);
 assert.equal(p.liveRetentionPolicyEnforced,false);
 for(const x of [{deleteAll:true},{removeOne:true},
  {changedAncestor:true},{opened:true}])
 await assert.rejects(retention(x),/R187 retention/,JSON.stringify(x));
});
test('R187 evidence gate re-verifies both Ed25519 signatures; no identity or production GO',async()=>{
 const result=await staged();
 assert.equal(result.decision,'NO_GO_REAL_STAGING_ATTESTATION_PENDING');
 assert.equal(result.verifiedSyntheticSignatures,2);
 assert.equal(result.syntheticExpiredRowsDeleted,4);
 assert.equal(result.humanIdentitiesIndependentlyVerified,false);
 assert.equal(result.productionAuthorized,false);
 for(const x of [{race:true},{open:true},{generationJump:true},
  {fakeRetention:true},{forgedDual:true},{corruptSignature:true},{fakeTls:true}])
 await assert.rejects(staged(x),
  /R187 staging gate|R187 attestation/,JSON.stringify(x));
});
test('R187 immutable PG17 ledger requires retention and R186 ancestor, disallows replay or promotion',async()=>{
 const p=await staged(),s=r187ObservationSql(p);
 for(const token of ['SERIALIZABLE','marcosa_r187_hold_writer',
  'r186_ci.staging_observation_holds','r186_ci.staging_observation_audit',
  'r187_ci.synthetic_retention','r187_ci.observation_holds',
  'r187_ci.observation_audit','ON CONFLICT DO NOTHING'])
 assert.ok(s.includes(token),token);
 for(const patch of [{decision:'PRODUCTION_GO'},
  {productionAuthorized:true},{sourceMode:'OPERATOR_READONLY_UNATTESTED'},
  {nonce:"' OR TRUE --"},{syntheticExpiredRowsDeleted:3},
  {dualAttestationEvidenceSha256:'short'}])
 assert.throws(()=>r187ObservationSql({...p,...patch}),/R187 ledger/);
 let c=0;
 const ledger=createR187ObservationLedger({
  executeSql:async()=>c++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'});
 assert.equal((await ledger.record(p)).recorded,true);
 await assert.rejects(ledger.record(p),/R187 ledger/);
});
