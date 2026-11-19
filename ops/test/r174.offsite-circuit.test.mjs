import test from 'node:test';
import assert from 'node:assert/strict';
import {createR174OffsiteCircuit,verifyR174IncidentChain}
 from '../r174/offsite-circuit.mjs';
const commit='a'.repeat(40),archiveSha256='b'.repeat(64),now=1800000000000;
function create(){
 const data=[];
 const control=createR174OffsiteCircuit({
  clock:()=>now,record:async e=>{
   data.push(e);
   return{accepted:true,sha256:e.sha256,sequence:e.seq};
  }
 });
 return{data,control};
}
test('R174 fail-closed circuit hashes KMS outage and manual reset with two independent approvals',async()=>{
 const f=create();
 assert.equal(f.control.requireClosed().closed,true);
 const e=await f.control.trip({
  type:'DESTINATION_KMS_DENIED',reason:'KMS_ACCESS_DENIED',
  commit,archiveSha256
 });
 assert.equal(e.seq,1);
 assert.equal(f.control.snapshot().stopped,true);
 assert.equal(f.control.snapshot().autoRetryEnabled,false);
 const approved='c'.repeat(64);
 const reset=await f.control.acknowledgeReset({
  reason:'REVIEWER_APPROVED',commit,archiveSha256,
  operatorApproved:true,reviewerApproved:true,
  evidenceSha256:approved,verifiedCheckpointSha256:approved
 });
 assert.equal(reset.audit.seq,2);
 assert.equal(f.control.snapshot().stopped,false);
 assert.equal(verifyR174IncidentChain(f.data).count,2);
 assert.throws(()=>f.control.requireClosed(),/not stopped/);
});
test('R174 refuses unilateral reset, tampered chain and arbitrary PII fields',async()=>{
 const f=create();
 await f.control.trip({type:'CIPHERTEXT_MISMATCH',
  reason:'SHA256_MISMATCH',commit,archiveSha256});
 for(const patch of [
  {operatorApproved:false,reviewerApproved:true},
  {operatorApproved:true,reviewerApproved:false},
  {operatorApproved:true,reviewerApproved:true,
   verifiedCheckpointSha256:'d'.repeat(64)}
 ])await assert.rejects(f.control.acknowledgeReset({
  reason:'REVIEWER_APPROVED',commit,archiveSha256,
  evidenceSha256:'c'.repeat(64),verifiedCheckpointSha256:'c'.repeat(64),
  ...patch
 }),/R174 offsite circuit breaker/);
 await assert.rejects(f.control.trip({
  type:'CUSTOM_ERROR',reason:'hello world',commit,archiveSha256
 }),/R174 offsite circuit breaker/);
 const forged=f.data.map(x=>({...x}));
 forged[0].reason='TAMPERED';
 assert.throws(()=>verifyR174IncidentChain(forged),/SHA-256 chain broken/);
});
test('R174 fail-closed if durable external incident audit write fails',async()=>{
 const c=createR174OffsiteCircuit({
  record:async()=>{throw Error('DB offline');}
 });
 await assert.rejects(c.trip({
  type:'PG_RESTORE_FAILED',reason:'RESTORE_FAILED',
  commit,archiveSha256
 }),/durable incident record rejected/);
 assert.equal(c.snapshot().stopped,true);
 assert.equal(c.snapshot().sequence,0);
});
