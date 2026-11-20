import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha} from '../r189/evidence.mjs';
import {assessHumanApprovals} from '../r189/human-approvals.mjs';
import {assessInfrastructure} from '../r189/infrastructure.mjs';
import {assessRecovery} from '../r189/recovery.mjs';
import {assessR189} from '../r189/release-gate.mjs';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const opts={commit,bundleSha256};
function proofs(){
 return {
 human:assessHumanApprovals({...opts,reviewers:[
  {personId:'reviewer1',role:'SECURITY',approval:true,verifiedByIndependentAuthority:true},
  {personId:'reviewer2',role:'OPERATIONS',approval:true,verifiedByIndependentAuthority:true},
  {personId:'reviewer3',role:'PRIVACY',approval:true,verifiedByIndependentAuthority:true}
 ],externalRegistryVerified:true}),
 infrastructure:assessInfrastructure({...opts,observations:Object.fromEntries(
  ['githubEnvironment','tlsCertificate','awsPermissions'].map(k=>
   [k,{observedSourceCommit:commit,verified:true,independentObserver:true}]))}),
 recovery:assessRecovery({...opts,backupSha256:'c'.repeat(64),
  primary:{recordCount:8,recordsSha256:'d'.repeat(64),forceRls:true,quarantineClosed:true},
  restored:{recordCount:8,recordsSha256:'d'.repeat(64),forceRls:true,quarantineClosed:true},
  externalWitness:true})
 };
}
test('R189 R188 regression guard pins exact disposable database argument',()=>{
 const code=readFileSync(new URL('../r188/ci-acceptance.mjs',import.meta.url),'utf8');
 assert.match(code,/readR187Hold: *\(\)=>holdRead\('postgres'\)/);
 assert.match(code,/only two disposable PG databases may be read/);
 assert.doesNotMatch(code,/readR187Hold:holdRead,quarantine/);
});
test('R189 human assertions reject duplicate identities, forged fields, missing role and live clearance',()=>{
 const p=proofs().human;
 assert.equal(p.reviewerQuorumClaim,true);
 assert.equal(p.actualIdentitiesVerifiedByThisModule,false);
 assert.equal(p.productionAuthorized,false);
 assert.throws(()=>assessHumanApprovals({...opts,reviewers:[
  {personId:'same',role:'SECURITY',approval:true,verifiedByIndependentAuthority:true},
  {personId:'same',role:'OPERATIONS',approval:true,verifiedByIndependentAuthority:true}
 ]}),/duplicate/);
 assert.throws(()=>assessHumanApprovals({...opts,sourceMode:'LIVE_PROD'}),/isolated/);
 assert.equal(assessHumanApprovals(opts).reviewerQuorumClaim,false);
});
test('R189 infrastructure contract blocks missing, foreign-source or extra evidence',()=>{
 const p=proofs().infrastructure;
 assert.equal(p.checks.length,3);
 assert.equal(p.allIndependentClaims,true);
 assert.equal(p.realProviderPermissionsMeasuredByThisModule,false);
 assert.equal(assessInfrastructure(opts).allIndependentClaims,false);
 assert.throws(()=>assessInfrastructure({...opts,observations:{awsPermissions:{
  observedSourceCommit:'f'.repeat(40),verified:true,independentObserver:true
 }}}),/source pinned/);
 assert.throws(()=>assessInfrastructure({...opts,observations:{credentials:'secret'}}),/unexpected/);
});
test('R189 independent restore comparison catches content, RLS and quarantine downgrades',()=>{
 const p=proofs().recovery;
 assert.equal(p.exactReadback,true);
 assert.equal(p.actualExternalRestoreVerifiedByThisModule,false);
 for(const change of [{recordsSha256:'e'.repeat(64)},{forceRls:false},{quarantineClosed:false}]){
  const x=assessRecovery({...opts,backupSha256:'c'.repeat(64),
   primary:{recordCount:8,recordsSha256:'d'.repeat(64),forceRls:true,quarantineClosed:true},
   restored:{recordCount:8,recordsSha256:'d'.repeat(64),forceRls:true,quarantineClosed:true,...change}});
  assert.equal(x.exactReadback,false);
 }
});
test('R189 immutable aggregated decision stays NO-GO even with all green synthetic claims',()=>{
 const p=proofs();
 const x=assessR189({...opts,...p,r188Commit:'e'.repeat(40),
  previousHead:'f'.repeat(40),ciR188Success:true});
 assert.equal(x.decision,'NO_GO_INDEPENDENT_STAGING_ACCEPTANCE_PENDING');
 assert.equal(x.productionAuthorized,false);
 assert.equal(x.blockers.length,4);
 assert.equal(x.evidenceSha256,sha(Object.fromEntries(Object.entries(x).filter(([k])=>k!=='evidenceSha256'))));
 assert.equal(assessR189({...opts,...p,r188Commit:'e'.repeat(40),
  previousHead:'f'.repeat(40)}).blockers[0],'R188_CI_NOT_VERIFIED');
 const modified={...p.human,productionAuthorized:true};
 assert.throws(()=>assessR189({...opts,...p,human:modified,
  r188Commit:'e'.repeat(40),previousHead:'f'.repeat(40)}),/invalid R189_HUMAN/);
 assert.throws(()=>assessR189({...opts,...p,r188Commit:'bad',
  previousHead:'f'.repeat(40)}),/references mandatory/);
});
