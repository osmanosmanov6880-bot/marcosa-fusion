import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateReleaseEvidence} from '../release-evidence-gate.mjs';
const keys=['supabaseProject','authRls','privateStorage','stagingHttps','sshHostVerified','backupsRestored','moderationLegal','paymentReconciliation','realBetaRetention','securityAudit'];
test('No evidence is never production ready',()=>{
 const v=evaluateReleaseEvidence({});
 assert.equal(v.productionReady,false);assert.deepEqual(v.missing,keys);
 assert.equal(v.checks.length,10);
});
test('Missing, malformed or failing evidence blocks release',()=>{
 for(const evidence of [{supabaseProject:{passed:true}}, {supabaseProject:{passed:true,reference:'http://invalid',verifiedAt:'today'}},{supabaseProject:{passed:false,reference:'https://example.org/review',verifiedAt:'2026-10-25T00:00:00Z'}}]){
  const x=evaluateReleaseEvidence(evidence);assert.equal(x.productionReady,false);assert.ok(x.missing.includes('supabaseProject'));
 }
 assert.throws(()=>evaluateReleaseEvidence(null),/object/);
});
test('All ten references require explicit passing review, but claims are not independent proof',()=>{
 const data=Object.fromEntries(keys.map(k=>[k,{passed:true,reference:'https://example.org/evidence/'+k,verifiedAt:'2026-10-25T12:00:00Z'}]));
 const v=evaluateReleaseEvidence(data);assert.equal(v.productionReady,true);assert.deepEqual(v.missing,[]);
 assert.match(v.warning,/self-reported/);
 delete data.securityAudit;
 assert.equal(evaluateReleaseEvidence(data).productionReady,false);
});