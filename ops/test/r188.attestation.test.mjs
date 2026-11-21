import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {r187AttestationMessage,createR187DualAttestation}
 from '../r187/dual-attestation.mjs';
import {createR188SignedTranscript,verifyR188SignedTranscript}
 from '../r188/signed-transcript.mjs';
import {r187SyntheticRetentionRows} from '../r187/privacy-retention.mjs';
import {createR188RetentionIntegrity}
 from '../r188/retention-integrity.mjs';
import {createR188StagingGate} from '../r188/staging-gate.mjs';
import {r188ObservationSql,createR188ObservationLedger}
 from '../r188/observation-ledger.mjs';
const sha=b=>createHash('sha256').update(
 typeof b==='string'||Buffer.isBuffer(b)?b:JSON.stringify(b)).digest('hex');
const t=1800000000000,clock=()=>t,commit='a'.repeat(40),
 bundleSha256='b'.repeat(64),runId=123456789,nonce='c'.repeat(32),
 githubEvidenceSha256='d'.repeat(64),httpsEvidenceSha256='e'.repeat(64);
function makeTranscript(){
 const a=generateKeyPairSync('ed25519');
 const b=generateKeyPairSync('ed25519');
 const keys=[
  {role:'PR_REVIEW',signerId:2002,
   publicKeySpkiBase64:a.publicKey.export({
    format:'der',type:'spki'}).toString('base64')},
  {role:'SECURITY_REVIEW',signerId:3003,
   publicKeySpkiBase64:b.publicKey.export({
    format:'der',type:'spki'}).toString('base64')}
 ];
 const packet={audience:'R187_READONLY_REVIEW_NOT_DEPLOY',
  sourceCommit:commit,bundleSha256,runId,nonce,
  githubEvidenceSha256,httpsEvidenceSha256,issuedAtMs:t-1000};
 const msg=r187AttestationMessage(packet);
 const signatures=[a,b].map((k,i)=>({
  role:keys[i].role,signerId:keys[i].signerId,
  signatureBase64url:sign(null,msg,k.privateKey).toString('base64url')
 }));
 const dualProof=createR187DualAttestation({expectedSigners:keys,
  clock,allowVerify:true}).inspect({packet,signatures});
 const portable=createR188SignedTranscript({packet,signatures,
  publicKeys:keys,dualProof,commit,bundleSha256,runId});
 return portable;
}
const priorRaw={schemaVersion:1,sourceCommit:commit,
 sourceBundleSha256:bundleSha256,runId,sequence:3,nonce,
 sourceMode:'CI_SYNTHETIC',
 decision:'NO_GO_REAL_STAGING_ATTESTATION_PENDING',
 realPilotAuthorized:false,productionAuthorized:false};
const hold={...priorRaw,evidenceSha256:sha(priorRaw)};
const witness={runId,sequence:3,nonce,sourceCommit:commit,
 r187EvidenceSha256:hold.evidenceSha256,
 decision:hold.decision,productionAuthorized:false};
const fixtures=r187SyntheticRetentionRows({commit,runId});
const rows=fixtures.slice(4).map(x=>({...x}));
const proofRaw={
 schemaVersion:1,scope:'disposable-pg17-synthetic-retention-only',
 sourceCommit:commit,sourceBundleSha256:bundleSha256,
 runId,sequence:3,nonce,
 r186EvidenceSha256:'f'.repeat(64),
 syntheticRowsBefore:12,syntheticExpiredRowsDeleted:4,
 syntheticActiveRowsRemaining:8,
 beforeRowsSha256:sha(fixtures),afterRowsSha256:sha(fixtures.slice(4)),
 rawCustomerDataProcessed:false,liveRetentionPolicyEnforced:false,
 realPrivacyComplianceAttested:false,quarantineClosed:true,
 decision:'NO_GO_SYNTHETIC_RETENTION_ONLY',
 realPilotAuthorized:false,productionAuthorized:false,
 observedAtMs:t
};
const retentionProof={...proofRaw,evidenceSha256:sha(proofRaw)};
function retention({tamper=false,restoreMissing=false,
 badRls=false,open=false,race=false}={}){
 let reads=0;
 return createR188RetentionIntegrity({
  readR187Hold:async()=>{reads++;return race&&reads>1?
   {...witness,sequence:4}:witness;},
  readRows:async db=>db==='marcosa_r187_restored'&&restoreMissing?
   rows.slice(0,7):tamper&&db==='postgres'?
    rows.map((r,i)=>i?{...r}:{...r,sha256:'0'.repeat(64)}):rows,
  readRlsState:async db=>({forced:!badRls,publicSelect:false}),
  readQuarantine:async()=>({closed:!open,generation:5}),
  clock,allowInspect:true
 }).inspect({commit,bundleSha256,runId,r187Proof:retentionProof});
}
async function gate(opts={}){
 const v=await retention();
 const transcript=makeTranscript();
 const report={
  schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
  finalHold:hold,r186Report:{githubProof:{evidenceSha256:githubEvidenceSha256}},
  tlsProof:{httpsEvidenceSha256},
  retentionProof,
  realPg17RetentionDeletedFour:true,
  realPg17EightActiveRetained:true,
  realPg17HoldAndAuditRestored:true,
  realPg17ReplayDenied:true,
  syntheticDnsAndHttps:true,syntheticEd25519Identities:true,
  realHumanIdentityVerified:false,realTlsIdentityAttested:false,
  realAwsEffectiveRightsVerified:false,realPrivacyComplianceVerified:false,
  realPilotAuthorized:false,productionAuthorized:false
 };
 let n=0;
 return createR188StagingGate({
  readR187Hold:async()=>{n++;return opts.race&&n>1?
   {...witness,sequence:4}:witness;},
  quarantine:{status:async()=>({closed:!opts.open,generation:5})},
  clock,allowInspect:true
 }).inspect({commit,bundleSha256,r187Report:report,
  retentionProof:opts.falseRetention?{...v,realRetentionComplianceVerified:true}:v,
  transcriptBytes:opts.badSignature?
   Buffer.from(transcript.bytes.toString('utf8').replace(
    'R187_READONLY_REVIEW_NOT_DEPLOY','PRODUCTION_GO')):transcript.bytes,
  transcriptFileSha256:transcript.fileSha256});
}
test('R188 independent portable Ed25519 signature replay survives distinct verifier instances',()=>{
 const p=makeTranscript();
 const r=verifyR188SignedTranscript({
  bytes:p.bytes,commit,bundleSha256,expectedFileSha256:p.fileSha256});
 assert.equal(r.verified,true);
 assert.equal(r.signerCount,2);
 assert.equal(r.productionAuthorized,false);
 const altered=Buffer.from(p.bytes.toString('utf8').replace(
  'R187_READONLY_REVIEW_NOT_DEPLOY','PRODUCTION_GO'));
 assert.throws(()=>verifyR188SignedTranscript({
  bytes:altered,commit,bundleSha256,
  expectedFileSha256:sha(altered)}),/R188 signed transcript/);
 const x=JSON.parse(p.bytes.toString('utf8'));
 x.publicKeys[1].publicKeySpkiBase64=x.publicKeys[0].publicKeySpkiBase64;
 const swapped=Buffer.from(JSON.stringify(x)+'\n');
 assert.throws(()=>verifyR188SignedTranscript({
  bytes:swapped,commit,bundleSha256,expectedFileSha256:sha(swapped)
 }),/R188 signed transcript|R187 attestation/);
});
test('R188 reads actual-format native PG17 source and restored synthetic retention contents',async()=>{
 const r=await retention();
 assert.equal(r.sourceRows,8);
 assert.equal(r.restoredRows,8);
 assert.equal(r.expiredRowsMissing,4);
 assert.equal(r.nativeForceRlsOnBothCopies,true);
 assert.equal(r.realPilotAuthorized,false);
 for(const opts of [{tamper:true},{restoreMissing:true},
  {badRls:true},{open:true},{race:true}])
 await assert.rejects(retention(opts),/R188 retention integrity/,
  JSON.stringify(opts));
});
test('R188 source-bound two-proof NO-GO gate rejects forged compliance, signatures and races',async()=>{
 const r=await gate();
 assert.equal(r.decision,
  'NO_GO_INDEPENDENT_LIVE_STAGING_APPROVAL_PENDING');
 assert.equal(r.syntheticVerifiedSignatures,2);
 assert.equal(r.realPilotAuthorized,false);
 assert.equal(r.productionAuthorized,false);
 for(const opts of [{falseRetention:true},{badSignature:true},
  {race:true},{open:true}])
 await assert.rejects(gate(opts),
  /R188 staging gate|R188 signed transcript/,
  JSON.stringify(opts));
});
test('R188 native PG17 append-only SQL binds signed bytes and both DB copies to one no-go',async()=>{
 const p=await gate(),sql=r188ObservationSql(p);
 for(const x of ['SERIALIZABLE','marcosa_r188_writer',
  'r187_ci.observation_holds','r187_ci.observation_audit',
  'r188_ci.attested_holds','r188_ci.attested_audit',
  'ON CONFLICT DO NOTHING'])
 assert.ok(sql.includes(x),x);
 for(const x of [{productionAuthorized:true},{decision:'PRODUCTION_GO'},
  {sourceMode:'LIVE_PROD'},{syntheticVerifiedSignatures:1},
  {sourceRemainingRows:7},{nonce:"' OR 1=1"},
  {transcriptSha256:'x'}])
 assert.throws(()=>r188ObservationSql({...p,...x}),
  /R188 observation ledger/);
 let n=0;
 const ledger=createR188ObservationLedger({
  executeSql:async()=>n++===0?'BEGIN\n1|1\nCOMMIT':
   'BEGIN\n0|0\nCOMMIT'
 });
 assert.equal((await ledger.record(p)).recorded,true);
 await assert.rejects(ledger.record(p),/R188 observation ledger/);
});
