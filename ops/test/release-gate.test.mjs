import test from 'node:test';
import assert from 'node:assert/strict';
import {REPOSITORY,PROFILES,evaluate} from '../../ops/check-release-gate.mjs';

const sha='a'.repeat(40);
const now=Date.parse('2026-10-25T12:00:00Z');
function proof(){return{status:'verified',artifact:'https://github.com/osmanosmanov6880-bot/marcosa-fusion/actions/runs/123456',checkedAt:'2026-10-24T12:00:00Z',reviewer:'Independent QA reviewer'};}
function fixture(profile){
 return {schemaVersion:1,repository:REPOSITORY,commit:sha,proofs:Object.fromEntries(PROFILES[profile].map(id=>[id,proof()])),approval:{status:'pending'}};
}
const audit=(o,profile='staging')=>evaluate(o,{profile,sha,now});

test('R48: empty, incomplete and unrecognized release profiles fail closed',()=>{
 const empty=audit({schemaVersion:1,repository:REPOSITORY,commit:sha,proofs:{},approval:{status:'pending'}});
 assert.equal(empty.decision,'BLOCKED');
 assert.equal(empty.missing.length,PROFILES.staging.length);
 assert.equal(empty.productionAuthorized,false);
 assert.equal(audit(null).decision,'BLOCKED');
 assert.equal(audit(fixture('staging'),'unknown').decision,'BLOCKED');
});
test('R48: all links only permit independent review, never automated production',()=>{
 for(const profile of ['staging','beta','public']){
  const output=audit(fixture(profile),profile);
  assert.equal(output.decision,'READY_FOR_INDEPENDENT_REVIEW');
  assert.equal(output.passingProofs,PROFILES[profile].length);
  assert.equal(output.productionAuthorized,false);
  assert.equal(output.missing.length,0);
  assert.equal(output.errors.length,0);
 }
});
test('R48: a staging pass cannot turn into beta or public release',()=>{
 const evidence=fixture('staging');
 assert.equal(audit(evidence,'beta').decision,'BLOCKED');
 assert.equal(audit(evidence,'public').decision,'BLOCKED');
 assert.ok(audit(evidence,'public').missing.length>10);
});
test('R48: stale, malformed and future proof never passes',()=>{
 const e=fixture('staging');
 e.proofs.ssh_host_key_verified_out_of_band.checkedAt='2026-01-01T00:00:00Z';
 let output=audit(e);assert.equal(output.decision,'BLOCKED');
 assert.match(output.missing[0].reason,/expired/);
 e.proofs.ssh_host_key_verified_out_of_band.checkedAt='2026-10-26T12:00:00Z';
 assert.equal(audit(e).decision,'BLOCKED');
 e.proofs.ssh_host_key_verified_out_of_band.checkedAt='not-a-date';
 assert.equal(audit(e).decision,'BLOCKED');
 e.proofs.ssh_host_key_verified_out_of_band.checkedAt='2026-10-24T12:00:00Z';
 e.proofs.ssh_host_key_verified_out_of_band.status='claimed';
 assert.equal(audit(e).decision,'BLOCKED');
});
test('R48: reject private URLs, pasted credentials and dangling artifacts',()=>{
 const e=fixture('staging');
 const id='https_tls';
 const rejected=[
  'http://github.com/issuer/artifact',
  'https://127.0.0.1/a',
  'https://localhost/a',
  'https://name:secret@github.com/a',
  'https://github.com/a?token=exposed',
  'https://github.com/a#private',
  'https://internal.local/proof',
  'https://github.com/'
 ];
 for(const link of rejected){
  e.proofs[id].artifact=link;
  const r=audit(e);
  assert.equal(r.decision,'BLOCKED',link);
 }
 e.proofs[id].artifact=proof().artifact;
 e.proofs[id].secret='never paste this';
 const result=audit(e);
 assert.equal(result.decision,'BLOCKED');
 assert.ok(result.errors.some(x=>x.includes('sensitive fields')));
});
test('R48: forged approval and wrong commit cannot bypass manual signoff',()=>{
 const e=fixture('public');
 e.commit='b'.repeat(40);
 assert.equal(audit(e,'public').decision,'BLOCKED');
 e.commit=sha;e.approval.status='approved';
 const result=audit(e,'public');
 assert.equal(result.productionAuthorized,false);
 assert.equal(result.decision,'BLOCKED');
 assert.ok(result.errors.some(x=>x.includes('not a deployment authorization')));
});
test('R48: no public proof can inject unknown top-level fields',()=>{
 const e=fixture('public');
 e.productionAuthorized=true;
 assert.equal(audit(e,'public').decision,'BLOCKED');
 delete e.productionAuthorized;
 e.proofs.someUnexpectedKey=proof();
 assert.equal(audit(e,'public').decision,'BLOCKED');
});
