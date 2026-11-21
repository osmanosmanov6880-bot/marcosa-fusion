import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessR152Staging,REQUIRED_R152_CHECKS} from './r152-readiness.mjs';
const sha='a'.repeat(40);
const example={repository:'osmanosmanov6880-bot/marcosa-fusion',ref:'refs/heads/main',commitSha:sha,
 checks:REQUIRED_R152_CHECKS.map(name=>({name,headSha:sha,conclusion:'success'})),
 manifestSha256:'f'.repeat(64),hostPinVerified:true,
 independentReview:true,httpsReadbackVerified:true,productionRequested:false};

test('staging preflight never authorizes release from missing or conflicting evidence',()=>{
 const none=assessR152Staging({});
 assert.equal(none.decision,'NO_GO');
 assert.equal(none.stagingDeploymentPerformed,false);
 assert.equal(none.commercialProductionAuthorized,false);
 assert.ok(none.blockers.includes('reviewed-main-ref'));
 for(const key of ['repository','ref','commitSha','checks','manifestSha256','hostPinVerified','independentReview','httpsReadbackVerified','productionRequested']){
  const replacement=key==='checks'?[]:key==='productionRequested'?true:null;
  const result=assessR152Staging({...example,[key]:replacement});
  assert.equal(result.decision,'NO_GO',key);
 }
 const bad=assessR152Staging({...example,checks:example.checks.map((x,i)=>i===1?{...x,headSha:'b'.repeat(40)}:x)});
 assert.equal(bad.decision,'NO_GO');
 const duplicate=assessR152Staging({...example,checks:[...example.checks.slice(0,3),example.checks[0]]});
 assert.equal(duplicate.decision,'NO_GO');
});
test('positive fixture only indicates eligibility for separate review, never deploy',()=>{
 const checked=assessR152Staging(example);
 assert.equal(checked.decision,'READY_FOR_SEPARATE_STAGING_RELEASE_REVIEW');
 assert.equal(checked.evidenceIsSelfReported,true);
 assert.equal(checked.independentEvidenceNotAuthenticatedByThisTool,true);
 assert.equal(checked.stagingDeploymentPerformed,false);
 assert.equal(checked.actualPayoutAuthorized,false);
});
test('R152 CI has no secrets, external deploy, or payment endpoints',()=>{
 const yml=readFileSync('.github/workflows/marcosa-r152-readiness.yml','utf8');
 assert.match(yml,/permissions:\s*\n\s*contents: read/);
 assert.doesNotMatch(yml,/secrets\./);
 assert.doesNotMatch(yml,/\bssh\b|\bscp\b|\brsync\b|stripe\.com|environment:\s*production/i);
 assert.match(yml,/node --test ops\/payment-contract\/creator-earnings-r152\.test\.mjs/);
 assert.match(yml,/node --test ops\/test\/r152\.disaster-recovery\.test\.mjs/);
});
