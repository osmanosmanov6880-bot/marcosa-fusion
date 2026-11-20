import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readR190GithubReviews} from '../r190/github-review.mjs';
import {r190ReviewMessage,verifyR190ReviewSignatures} from '../r190/human-signatures.mjs';
import {readR190StagingHttps} from '../r190/https-readback.mjs';
import {assessR190} from '../r190/final-gate.mjs';
import {r190NativeHoldSql,createR190NativeLedger} from '../r190/native-ledger.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const sourceCommit='a'.repeat(40),bundleSha256='b'.repeat(64),
 at=1800000000000,clock=()=>at;
const opts={commit:sourceCommit,bundleSha256,clock};
function fetchReviewFixture(events=[],head=sourceCommit,author='author1'){
 return async(url,request)=>{
  assert.equal(request.method,'GET');
  assert.equal(request.redirect,'error');
  const data=url.includes('/reviews?')?events:{
   number:168,head:{sha:head},base:{ref:'main'},
   user:{login:author},state:'open'};
  return{status:200,redirected:false,url,text:async()=>JSON.stringify(data)};
 };
}
function reviewAssignments(){return{SECURITY:'reviewer1',OPERATIONS:'reviewer2',PRIVACY:'reviewer3'};}
async function github(events){
 return readR190GithubReviews({...opts,assignments:reviewAssignments(),
  fetchImpl:fetchReviewFixture(events)});
}
const cleanReviews=()=>['reviewer1','reviewer2','reviewer3'].map((s,i)=>
 ({id:i+1,user:{login:s,type:'User'},state:'APPROVED',commit_id:sourceCommit}));
function tripleSignature(githubEvidenceSha256,tlsEvidenceSha256){
 const packet={sourceCommit,bundleSha256,githubEvidenceSha256,tlsEvidenceSha256,
  nonce:'c'.repeat(32),issuedAtMs:at-1000,expiresAtMs:at+10000};
 const registry={};
 const signatures=[];
 for(const role of ['SECURITY','OPERATIONS','PRIVACY']){
  const pair=generateKeyPairSync('ed25519');
  const der=pair.publicKey.export({type:'spki',format:'der'});
  const signerId=role.toLowerCase()+'_human';
  registry[role]={signerId,publicKeySpkiBase64:der.toString('base64'),
   keyFingerprintSha256:sha(der)};
  signatures.push({role,signerId,signatureBase64url:
   sign(null,r190ReviewMessage(packet),pair.privateKey).toString('base64url')});
 }
 return {packet,registry,signatures};
}
function mockHttpsRequest(url,options,handler){
 const req=new EventEmitter();
 req.end=()=>{
  const path=new URL(url).pathname;
  const res=new PassThrough();
  res.statusCode=200;
  res.headers={
   'strict-transport-security':'max-age=31536000',
   'x-content-type-options':'nosniff',
   'cache-control':'no-store',
   'content-type':'application/json'
  };
  queueMicrotask(()=>{
   handler(res);
   if(options.method==='HEAD')res.end();
   else res.end(JSON.stringify({status:path==='/health'?'ok':'ready'}));
  });
 };
 req.destroy=()=>req.emit('error',new Error('destroy'));
 return req;
}
async function tls(){
 return readR190StagingHttps({...opts,runId:123456,
  hostname:'staging.example.com',allowNetwork:true,
  resolveAddresses:async()=>[{family:4,address:'8.8.8.8'}],
  httpsRequest:mockHttpsRequest});
}
test('R190 reads the real-format GitHub head, chronology, reviewer independence and dismissals',async()=>{
 const approved=await github(cleanReviews());
 assert.equal(approved.allCurrentHeadReviewClaimsSatisfied,true);
 assert.equal(approved.identitiesIndependentlyEstablished,false);
 const stale=await github([...cleanReviews(),
  {id:20,user:{login:'reviewer2',type:'User'},
   state:'CHANGES_REQUESTED',commit_id:sourceCommit}]);
 assert.equal(stale.allCurrentHeadReviewClaimsSatisfied,false);
 assert.equal(stale.reviewChecks[1].approved,false);
 const oldHead=await github(cleanReviews().map(x=>({...x,commit_id:'f'.repeat(40)})));
 assert.equal(oldHead.allCurrentHeadReviewClaimsSatisfied,false);
 await assert.rejects(readR190GithubReviews({...opts,
  fetchImpl:fetchReviewFixture(cleanReviews(),'f'.repeat(40))}),/head drift/);
 await assert.rejects(readR190GithubReviews({...opts,
  assignments:{SECURITY:'same',OPERATIONS:'same'},
  fetchImpl:fetchReviewFixture()}),/distinct role/);
});
test('R190 checks three independent real Ed25519 signatures, pinned DER keys, expiry and revocation',()=>{
 const p=tripleSignature('d'.repeat(64),'e'.repeat(64));
 const r=verifyR190ReviewSignatures({...p,clock});
 assert.equal(r.cryptographicSignaturesVerified,3);
 assert.equal(r.externallyVerifiedHumanIdentities,false);
 assert.equal(r.productionAuthorized,false);
 const tamper=p.signatures.map(x=>({...x}));
 tamper[0].signatureBase64url='A'.repeat(86);
 assert.throws(()=>verifyR190ReviewSignatures({...p,signatures:tamper,clock}),/signature/);
 assert.throws(()=>verifyR190ReviewSignatures({...p,clock:()=>at+11000}),/expired/);
 assert.throws(()=>verifyR190ReviewSignatures({...p,clock,
  revokedFingerprints:[p.registry.SECURITY.keyFingerprintSha256]}),/revoked/);
 const swapped={...p.registry,OPERATIONS:{...p.registry.SECURITY}};
 assert.throws(()=>verifyR190ReviewSignatures({...p,registry:swapped,clock}),/registry|reused/);
 assert.throws(()=>verifyR190ReviewSignatures({...p,
  packet:{...p.packet,sourceCommit:'f'.repeat(40)},clock}),/signature/);
});
test('R190 real R187 DNS-pinned, no-cookie HTTPS adapter and private-IP refusal',async()=>{
 const t=await tls();
 assert.equal(t.allReadOnlyHealthChecksPassed,true);
 assert.equal(t.pinnedAddressCount,1);
 assert.equal(t.externalTlsIdentityIndependentlyVerified,false);
 assert.equal(t.productionAuthorized,false);
 await assert.rejects(readR190StagingHttps({...opts,
  hostname:'staging.example.com',runId:123456}),/explicit read-only/);
 await assert.rejects(readR190StagingHttps({...opts,
  hostname:'staging.example.com',runId:123456,allowNetwork:true,
  resolveAddresses:async()=>[{family:4,address:'127.0.0.1'}],
  httpsRequest:mockHttpsRequest}),/DNS resolved/);
});
test('R190 cross-source final decision rejects hash substitution and fake GO',async()=>{
 const g=await github(cleanReviews());
 const t=await tls();
 const signers=verifyR190ReviewSignatures({
  ...tripleSignature(g.evidenceSha256,t.evidenceSha256),clock});
 const input={sourceCommit,bundleSha256,r189Commit:'f'.repeat(40),
  github:g,signers,tls:t,nativePg17Witness:true};
 const report=assessR190(input);
 assert.equal(report.productionAuthorized,false);
 assert.equal(report.decision,'NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING');
 assert.ok(report.blockers.includes('HUMAN_IDENTITIES_NOT_INDEPENDENTLY_VERIFIED'));
 assert.throws(()=>assessR190({...input,tls:{...t,productionAuthorized:true}}),/invalid R190_TLS/);
 assert.throws(()=>assessR190({...input,tls:{...t,
  allReadOnlyHealthChecksPassed:false}}),/tampered/);
 const other=await github([]);
 assert.throws(()=>assessR190({...input,github:other}),/source or NO-GO ancestry mismatch/);
});
test('R190 PG17 SQL enforces serializable one-use append, independent audit and no GO',async()=>{
 const packet={sourceCommit,r189Commit:'f'.repeat(40),bundleSha256,
  githubEvidenceSha256:'c'.repeat(64),
  signaturesEvidenceSha256:'d'.repeat(64),
  tlsEvidenceSha256:'e'.repeat(64),
  decision:'NO_GO_EXTERNAL_STAGING_APPROVAL_PENDING',
  sourceMode:'CI_SYNTHETIC',productionAuthorized:false};
 const sql=r190NativeHoldSql(packet);
 for(const item of ['SERIALIZABLE','marcosa_r190_writer',
  'r190_ci.immutable_hold','r190_ci.immutable_audit','ON CONFLICT DO NOTHING'])
  assert.ok(sql.includes(item),item);
 for(const x of [{productionAuthorized:true},{sourceMode:'LIVE'},
  {decision:'GO'},{githubEvidenceSha256:"' OR 1=1"}])
  assert.throws(()=>r190NativeHoldSql({...packet,...x}),/only exact/);
 let n=0;
 const db=createR190NativeLedger({executeSql:async()=>n++===0?'1|1':'0|0'});
 assert.equal((await db.record(packet)).recorded,true);
 await assert.rejects(db.record(packet),/duplicate or partial/);
});
