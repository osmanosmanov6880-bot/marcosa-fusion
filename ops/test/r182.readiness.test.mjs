import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildR178ReadOnlyIamBlueprint} from '../r178/iam-plan.mjs';
import {createR182IamPostureAudit} from '../r182/iam-posture.mjs';
import {createR182RecoveryDrill} from '../r182/restore-drill.mjs';
import {createR182ReadinessBarrier} from '../r182/readiness-evidence.mjs';
import {r182ReadinessSql,createR182ReadinessLedger}
 from '../r182/readiness-ledger.mjs';
import {createR181AwsCliExecutor} from '../r181/aws-readonly-cli.mjs';
const sha=b=>createHash('sha256').update(
 typeof b==='string'?b:JSON.stringify(b)).digest('hex');
const time=1800000000000,clock=()=>time,commit='a'.repeat(40);
const bundleSha256='b'.repeat(64),runId=123456789;
const source={profile:'source_ci',accountId:'111122223333',
 region:'eu-west-1',bucket:'marcosa-source-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
const offsite={profile:'offsite_ci',accountId:'444455556666',
 region:'eu-central-1',bucket:'marcosa-offsite-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
const plan=buildR178ReadOnlyIamBlueprint({source,offsite});
function iam({wrongTrust=false,attached=false,weakBoundary=false,
  extraPolicy=false,networkDown=false}={}){
 const executeAws=async({profile,operation,params})=>{
  if(networkDown)throw Error('IAM unavailable');
  const idx=profile===source.profile?0:1,spec=plan.plans[idx];
  assert.equal(params.RoleName,'marcosa-r178-readonly-auditor');
  switch(operation){
   case 'get-role':return{json:{Role:{
    Arn:spec.roleArn,RoleName:'marcosa-r178-readonly-auditor',
    MaxSessionDuration:3600,
    PermissionsBoundary:{PermissionsBoundaryArn:weakBoundary?'bad':
     'arn:aws:iam::'+spec.accountId+':policy/marcosa-staging-readonly-boundary'},
    AssumeRolePolicyDocument:wrongTrust?{Version:'2012-10-17',
     Statement:[]} :spec.trustPolicy}}};
   case 'list-role-policies':return{json:{IsTruncated:false,
    PolicyNames:extraPolicy?['marcosa-r182-staging-readonly','extra']:
     ['marcosa-r182-staging-readonly']}};
   case 'list-attached-role-policies':return{json:{IsTruncated:false,
    AttachedPolicies:attached?[{PolicyName:'AdministratorAccess'}]:[]}};
   case 'get-role-policy':return{json:{
    RoleName:'marcosa-r178-readonly-auditor',
    PolicyName:'marcosa-r182-staging-readonly',
    PolicyDocument:spec.permissionsPolicy}};
   default:throw Error('mutating IAM command');
  }
 };
 return createR182IamPostureAudit({source,offsite,
  executeAws,clock,allowNetwork:true});
}
const witness={runId,sequence:3,nonce:'1'.repeat(32),
 sourceCommit:commit,r181EvidenceSha256:'2'.repeat(64),
 r180ClassificationSha256:'3'.repeat(64),
 r180QuorumReceiptSha256:'4'.repeat(64),
 decision:'NO_GO_PROVIDER_ATTESTATION_PENDING',
 productionAuthorized:false};
const sourceRecord={
 ...witness,holdDecision:'NO_GO_EXTERNAL_EVIDENCE_PENDING',
 observationDecision:'NO_GO_PROVIDER_ATTESTATION_PENDING',
 quarantineClosed:true,rlsEnforced:true
};
delete sourceRecord.decision;
function drill({slow=false,changed=false,open=false,invalidDump=false,
 failRestore=false}={}){
 let tick=0;
 const buf=Buffer.alloc(1024,0x55);
 if(!invalidDump)buf.write('PGDMP');
 return createR182RecoveryDrill({
  readSource:async()=>sourceRecord,
  dumpSource:async()=>Buffer.from(buf),
  restoreToIsolated:async()=>{
   if(failRestore)throw Error('restore failed');
   tick=slow?200000:1200;},
  readRestored:async()=>changed?{...sourceRecord,sequence:4}:sourceRecord,
  readQuarantine:async()=>({closed:!open,generation:5}),
  monotonic:()=>tick,clock,allowDisposableRestore:true
 });
}
function report(){
 const p={
  schemaVersion:1,sourceMode:'CI_SYNTHETIC',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  runId,sequence:witness.sequence,nonce:witness.nonce,
  classificationSha256:witness.r180ClassificationSha256,
  quorumReceiptSha256:witness.r180QuorumReceiptSha256,
  sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
  decision:'NO_GO_PROVIDER_ATTESTATION_PENDING',
  actualIndependentProviderAttestation:false,
  naturalPersonSeparationIndependentlyVerified:false,
  restoreRpoRtoAndPrivacyVerified:false,productionAuthorized:false
 };
 const observation={...p,evidenceSha256:sha(p)};
 const sourceWitness={...witness,r181EvidenceSha256:observation.evidenceSha256};
 return{observation,sourceWitness,r181Report:{
  schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
  r180ClassificationSha256:witness.r180ClassificationSha256,
  r180QuorumReceiptSha256:witness.r180QuorumReceiptSha256,
  observation,realAwsProvidersIndependentlyAttested:false,
  realHumanReviewersVerified:false,productionAuthorized:false}};
}
const baseReport=report();
function drillOf(r){
 const fixed={...sourceRecord,r181EvidenceSha256:r.sourceWitness.r181EvidenceSha256};
 let tick=0;
 return createR182RecoveryDrill({
  readSource:async()=>fixed,
  dumpSource:async()=>{const b=Buffer.alloc(1024,0x5a);b.write('PGDMP');return b;},
  restoreToIsolated:async()=>{tick=1500;},
  readRestored:async()=>fixed,
  readQuarantine:async()=>({closed:true,generation:5}),
  monotonic:()=>tick,clock,allowDisposableRestore:true
 });
}
async function readiness({race=false,opened=false,tamperIam=false,
  fakeRpo=false}={}){
 const r=baseReport;
 const iamProof=await iam().inspect({commit,bundleSha256});
 const drillProof=await drillOf(r).inspect({commit,bundleSha256,runId});
 let n=0;
 const barrier=createR182ReadinessBarrier({
  readR181Witness:async()=>{
   n++;return race&&n>1?{...r.sourceWitness,sequence:4}:r.sourceWitness;},
  quarantine:{status:async()=>({closed:!opened,generation:5})},
  clock,allowInspect:true});
 return barrier.inspect({
  r181Report:r.r181Report,
  iamProof:tamperIam?{...iamProof,effectiveIamRightsIndependentlyVerified:true}:
   iamProof,
  drillProof:fakeRpo?{...drillProof,realProductionRpoRtoMeasured:true}:
   drillProof,commit,bundleSha256});
}
test('R182 IAM read-only contract checks two independent exact OIDC inline policies',async()=>{
 const r=await iam().inspect({commit,bundleSha256});
 assert.equal(r.exactTwoRoleReadOnlyShapeMatched,true);
 assert.equal(r.effectiveIamRightsIndependentlyVerified,false);
 assert.equal(r.productionAuthorized,false);
 assert.match(r.evidenceSha256,/^[a-f0-9]{64}$/);
 for(const opts of [{wrongTrust:true},{attached:true},
  {weakBoundary:true},{extraPolicy:true},{networkDown:true}])
 await assert.rejects(iam(opts).inspect({commit,bundleSha256}),
  /R182 IAM posture/);
});
test('R182 system AWS CLI cannot execute IAM write, AWS IAM role cannot be wildcard',async()=>{
 const exec=createR181AwsCliExecutor();
 await assert.rejects(exec({profile:'source_ci',region:'eu-west-1',
  service:'iam',operation:'put-role-policy',
  params:{RoleName:'marcosa-r178-readonly-auditor'}}),
  /R181 AWS read-only/);
 await assert.rejects(exec({profile:'source_ci',region:'eu-west-1',
  service:'iam',operation:'get-role',params:{RoleName:'Administrator'}}),
  /R181 AWS read-only/);
});
test('R182 measured disposable PG17 custom restore is not real RPO/RTO',async()=>{
 const r=await drill().inspect({commit,bundleSha256,runId});
 assert.equal(r.measuredRestoreMs,1200);
 assert.equal(r.observedFrozenSnapshotLossMs,0);
 assert.equal(r.realProductionRpoRtoMeasured,false);
 for(const options of [{slow:true},{changed:true},
  {open:true},{invalidDump:true},{failRestore:true}])
 await assert.rejects(drill(options).inspect({commit,bundleSha256,runId}),
  /R182 recovery drill|restore failed/);
 await assert.rejects(drill().inspect({commit,bundleSha256,runId,
  targetDatabase:'postgres'}),/R182 recovery drill/);
});
test('R182 source R181, IAM, drill and closed quarantine cannot be falsely elevated',async()=>{
 const e=await readiness({});
 assert.equal(e.decision,'NO_GO_INDEPENDENT_ATTESTATION_PENDING');
 assert.equal(e.closedQuarantineVerified,true);
 assert.equal(e.productionAuthorized,false);
 assert.equal(e.realProductionRpoRtoVerified,false);
 for(const bad of [{race:true},{opened:true},
  {tamperIam:true},{fakeRpo:true}])
 await assert.rejects(readiness(bad),/R182 readiness barrier/);
});
test('R182 serializable PostgreSQL18? no, PG17 source joined R181/R180 and replay denied',async()=>{
 const e=await readiness({});
 const sql=r182ReadinessSql(e);
 for(const token of ['SERIALIZABLE','marcosa_r182_writer',
  'r181_ci.observations','r181_ci.observation_audit',
  'r180_ci.holds','r182_ci.readiness_audit','ON CONFLICT DO NOTHING'])
  assert.ok(sql.includes(token),token);
 for(const patch of [{decision:'PRODUCTION_GO'},
  {productionAuthorized:true},{nonce:"' OR 1=1"},
  {iamEvidenceSha256:'bad'},{sourceAccountId:offsite.accountId}])
  assert.throws(()=>r182ReadinessSql({...e,...patch}),
   /R182 readiness ledger/);
 let n=0;
 const l=createR182ReadinessLedger({executeSql:async()=>n++===0?
  'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'});
 assert.equal((await l.record(e)).recorded,true);
 await assert.rejects(l.record(e),/R182 readiness ledger/);
 await assert.rejects(createR182ReadinessLedger({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).record(e),/R182 readiness ledger/);
});
