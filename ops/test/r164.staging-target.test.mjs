import test from 'node:test';
import assert from 'node:assert/strict';
import {createR164StagingTarget,verifyR164StagingTarget} from '../r164/staging-target.mjs';
const valid=()=>({schemaVersion:1,repository:'osmanosmanov6880-bot/marcosa-fusion',
 stage:'isolated-staging',commit:'a'.repeat(40),bundleSha256:'b'.repeat(64),
 projectRef:'abcdefghijklmnopqrst',stagingOrigin:'https://staging.example.invalid',
 databaseHost:'db-stage.example.invalid',dbCaSha256:'c'.repeat(64),
 tlsSpkiSha256:'d'.repeat(64),secretConfigFingerprint:'e'.repeat(20),
 listenHost:'127.0.0.1',synthetic:true,automatedDeploy:false,
 externalDelivery:false,paymentsEnabled:false,payoutsEnabled:false});
test('R164 exact staging-only descriptor binds Git, X509 and sealed-config identities',()=>{
 const input=valid(),a=createR164StagingTarget(input),
 b=createR164StagingTarget({...input});
 assert.equal(a.digest,b.digest);
 assert.equal(a.productionAuthorized,false);
 const proof=verifyR164StagingTarget(input,{commit:input.commit,
  bundleSha256:input.bundleSha256,
  secretConfigFingerprint:input.secretConfigFingerprint,digest:a.digest});
 assert.equal(proof.verifiedAgainstExpectedIdentity,true);
 assert.equal(proof.liveSupabaseConnected,false);
});
test('R164 unknown properties, changed X509, weak stage and production effects denied',()=>{
 const baseline=valid();
 const changes=[
  {stage:'production'},{automatedDeploy:true},{externalDelivery:true},
  {paymentsEnabled:true},{payoutsEnabled:true},{listenHost:'0.0.0.0'},
  {dbCaSha256:'0'}, {projectRef:'short'}, {databaseHost:'127.0.0.1'},
  {stagingOrigin:'https://staging.example.invalid/evil'},
  {stagingOrigin:'https://staging.example.invalid:8443'},
  {stagingOrigin:'http://staging.example.invalid'},
  {secret:'never-commit'},{synthetic:false},
 ];
 for(const change of changes)
  assert.throws(()=>createR164StagingTarget({...baseline,...change}),/R164 target/);
 const a=createR164StagingTarget(baseline);
 assert.throws(()=>verifyR164StagingTarget({...baseline,tlsSpkiSha256:'f'.repeat(64)},
  {commit:baseline.commit,bundleSha256:baseline.bundleSha256,
   secretConfigFingerprint:baseline.secretConfigFingerprint,digest:a.digest}),/modified/);
});
test('R164 external staging descriptor requires explicitly different non-fixture endpoints',()=>{
 const s={...valid(),synthetic:false,
  stagingOrigin:'https://staging.audit.example.org',
  databaseHost:'db-stage.audit.example.org'};
 const d=createR164StagingTarget(s);
 assert.equal(d.synthetic,false);
 assert.equal(d.approvedForOperatorReview,false);
 assert.equal(d.externalDeploymentVerified,false);
});
