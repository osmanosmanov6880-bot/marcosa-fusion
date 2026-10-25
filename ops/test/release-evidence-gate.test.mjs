import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateReleaseEvidence} from '../release-evidence-gate.mjs';
import {PROFILES,REPOSITORY} from '../check-release-gate.mjs';

const sha='a'.repeat(40),now=Date.parse('2026-10-25T12:00:00Z');
const proof=()=>({status:'verified',artifact:'https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/123456',
 checkedAt:'2026-10-24T12:00:00Z',reviewer:'Independent security reviewer'});
const all=()=>({schemaVersion:1,repository:REPOSITORY,commit:sha,
 proofs:Object.fromEntries(PROFILES.public.map(k=>[k,proof()])),approval:{status:'pending'}});
const verify=e=>evaluateReleaseEvidence(e,{sha,now});
test('R80: incomplete or unpinned evidence always BLOCKED and never productionReady',()=>{
 for(const e of [{},null,{schemaVersion:1,repository:REPOSITORY,commit:sha,proofs:{},approval:{status:'pending'}}]){
  const result=verify(e);
  assert.equal(result.decision,'BLOCKED');assert.equal(result.productionReady,false);
  assert.equal(result.productionAuthorized,false);assert.equal(result.readyForIndependentReview,false);
 }
 const unpinned=evaluateReleaseEvidence(all());
 assert.equal(unpinned.decision,'BLOCKED');assert.equal(unpinned.productionReady,false);
});
test('R80: all public R48 proofs enable human review ONLY — not automatic production',()=>{
 const e=all(),v=verify(e);
 assert.equal(v.decision,'READY_FOR_INDEPENDENT_REVIEW');
 assert.equal(v.readyForIndependentReview,true);
 assert.equal(v.productionReady,false);
 assert.equal(v.productionAuthorized,false);
 assert.equal(v.requiredProofs,PROFILES.public.length);
 assert.equal(v.passingProofs,PROFILES.public.length);
 assert.match(v.warning,/self-attested/);
});
test('R80: forged approvals, mismatched SHA, expired proof and embedded secrets block release',()=>{
 const e=all();e.approval.status='approved';
 assert.equal(verify(e).decision,'BLOCKED');
 e.approval.status='pending';e.commit='b'.repeat(40);
 assert.equal(verify(e).decision,'BLOCKED');
 e.commit=sha;e.proofs.staging_isolation.checkedAt='2025-01-01T12:00:00Z';
 assert.equal(verify(e).decision,'BLOCKED');
 e.proofs.staging_isolation=proof();e.proofs.media_storage_private_acl.apiKey='unsafe';
 assert.equal(verify(e).decision,'BLOCKED');
 e.proofs.media_storage_private_acl=proof();delete e.proofs.media_storage_private_acl;
 assert.equal(verify(e).decision,'BLOCKED');
});
