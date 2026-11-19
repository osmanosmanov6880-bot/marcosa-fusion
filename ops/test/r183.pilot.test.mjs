import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildR178ReadOnlyIamBlueprint} from '../r178/iam-plan.mjs';
import {createR182IamPostureAudit} from '../r182/iam-posture.mjs';
import {createR183BoundaryAudit} from '../r183/boundary-policy.mjs';
import {createR183PrReviewAudit} from '../r183/github-pr-review.mjs';
import {createR183DeltaRecovery} from '../r183/delta-recovery.mjs';
import {createR183PilotGate} from '../r183/pilot-gate.mjs';
import {r183PilotSql,createR183PilotLedger} from '../r183/pilot-ledger.mjs';
import {createR181AwsCliExecutor} from '../r181/aws-readonly-cli.mjs';
const sha=x=>createHash('sha256').update(
 typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const hashC=x=>sha(JSON.stringify(canon(x)));
const now=1800000000000,clock=()=>now,commit='a'.repeat(40),
 bundleSha256='b'.repeat(64),runId=123456789,nonce='c'.repeat(32);
const source={profile:'source_ci',region:'eu-west-1',
 accountId:'111122223333',bucket:'marcosa-source-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
const offsite={profile:'offsite_ci',region:'eu-central-1',
 accountId:'444455556666',bucket:'marcosa-offsite-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
const blueprint=buildR178ReadOnlyIamBlueprint({source,offsite});
const boundaryName='marcosa-staging-readonly-boundary',
 roleName='marcosa-r178-readonly-auditor';
const rolePolicyName='marcosa-r182-staging-readonly';
function executeIam({tamperBoundary=false,wrongDefault=false,expandPolicy=false,
 missing=false,attached=false,wrongTrust=false}={}){
 return async({profile,service,operation,params})=>{
  if(missing)throw Error('AWS IAM access denied');
  assert.equal(service,'iam');
  const i=profile===source.profile?0:profile===offsite.profile?1:-1;
  assert.notEqual(i,-1);
  const t=i?offsite:source,plan=blueprint.plans[i];
  switch(operation){
   case 'get-role':return{json:{Role:{
    Arn:plan.roleArn,RoleName:roleName,MaxSessionDuration:3600,
    PermissionsBoundary:{PermissionsBoundaryArn:
     'arn:aws:iam::'+t.accountId+':policy/'+boundaryName},
    AssumeRolePolicyDocument:wrongTrust?{
     Version:'2012-10-17',Statement:[]
    }:plan.trustPolicy}}};
   case 'list-role-policies':return{json:{
    IsTruncated:false,PolicyNames:[rolePolicyName]}};
   case 'list-attached-role-policies':return{json:{
    IsTruncated:false,AttachedPolicies:attached?[{PolicyName:'AdministratorAccess'}]:[]}};
   case 'get-role-policy':return{json:{
    RoleName:roleName,PolicyName:rolePolicyName,
    PolicyDocument:plan.permissionsPolicy}};
   case 'get-policy':return{json:{Policy:{
    Arn:params.PolicyArn,DefaultVersionId:'v3',
    IsAttachable:true,AttachmentCount:2}}};
   case 'get-policy-version':return{json:{PolicyVersion:{
    VersionId:wrongDefault?'v4':'v3',IsDefaultVersion:true,
    Document:tamperBoundary?{Version:'2012-10-17',
     Statement:[{Effect:'Allow',Action:'s3:*',Resource:'*'}]}:
     expandPolicy?{...plan.permissionsPolicy,Extra:1}:
     encodeURIComponent(JSON.stringify(plan.permissionsPolicy))}}};
   default:throw Error('mutation rejected');
  }
 };
}
async function iamProof(opts={}){
 return createR182IamPostureAudit({
  source,offsite,executeAws:executeIam(opts),
  clock,allowNetwork:true
 }).inspect({commit,bundleSha256});
}
function boundary(opts={}){
 return createR183BoundaryAudit({
  source,offsite,executeAws:executeIam(opts),
  clock,allowNetwork:true
 });
}
const author=101,reviewerIds=[2002,3003];
function prAudit({one=false,self=false,wrongSha=false,badSignature=false,
 rejected=false,withdrawn=false,changedSha=false,
 unauthorized=false,stale=false,otherReview=false,
 outOfDate=false}={}){
 const base={'full_name':'osmanosmanov6880-bot/marcosa-fusion'};
 const pr={number:168,state:'open',draft:false,user:{id:author,type:'User'},
  head:{sha:wrongSha?'f'.repeat(40):commit,
   ref:'feature/marcosa-r150-growth-economics',repo:base},
  base:{ref:'feature/series-pilot-r149',repo:base}};
 const commitAt=new Date(now-15000).toISOString();
 const gitCommit={sha:commit,
  commit:{committer:{date:commitAt},
   verification:{verified:!badSignature}}};
 const reviews=(one?reviewerIds.slice(0,1):reviewerIds)
  .map((id,i)=>({id:12+i,user:{id:self&&i===0?author:id,type:'User'},
   commit_id:changedSha?'f'.repeat(40):commit,
   state:rejected&&i===0?'CHANGES_REQUESTED':'APPROVED',
   submitted_at:new Date(now-2000).toISOString()}));
 if(withdrawn)reviews.push({id:99,user:{id:reviewerIds[0],type:'User'},
  commit_id:commit,state:'CHANGES_REQUESTED',
  submitted_at:new Date(now-1000).toISOString()});
 if(otherReview)reviews.push({id:102,user:{id:4004,type:'User'},
  commit_id:commit,state:'CHANGES_REQUESTED',
  submitted_at:new Date(now-1000).toISOString()});
 const fetcher=async url=>{
  if(unauthorized&&url.includes('/reviews'))return{
   status:403,headers:{get:()=> 'application/json'},
   text:async()=>'{"message":"Forbidden"}'};
  const data=url.includes('/reviews')?reviews:
   url.includes('/commits/')?(stale?{
    ...gitCommit,commit:{committer:{date:new Date(now-20*86400000).toISOString()}}
   }:gitCommit):outOfDate?{
    ...pr,base:{ref:'main',repo:base}
   }:pr;
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(data)};
 };
 return createR183PrReviewAudit({
  fetcher,token:'synthetic-r183-gh-token',
  reviewerIds,commit,clock,allowNetwork:true
 });
}
const r182Evidence={
 runId,sequence:3,nonce,sourceCommit:commit,
 r182EvidenceSha256:'d'.repeat(64),
 decision:'NO_GO_INDEPENDENT_ATTESTATION_PENDING',
 rlsEnforced:true,productionAuthorized:false
};
function delta({postMissing=false,restoredFuture=false,invalidDump=false,
 changedSource=false,open=false,slow=false,baselineMissing=false}={}){
 let markers=[],snap=[],step=100;
 const readR182Witness=async db=>
  changedSource&&db==='postgres'&&markers.length===2?
   {...r182Evidence,sequence:4}:r182Evidence;
 const readMarkers=async db=>{
  if(db==='postgres')return markers.map(x=>({...x}));
  if(db==='marcosa_r183_delta')return snap.map(x=>({...x}));
  throw Error('wrong database');
 };
 return createR183DeltaRecovery({
  readR182Witness,
  quarantine:{status:async()=>({closed:!open,generation:5})},
  writeBaseline:async x=>{if(!baselineMissing)markers.push(x);},
  dumpSource:async()=>{
   snap=markers.map(x=>({...x}));
   const b=Buffer.alloc(1200,0x4a);
   if(!invalidDump)b.write('PGDMP');
   return b;
  },
  writeAfterBackup:async x=>{if(!postMissing)markers.push(x);},
  restoreToIsolated:async()=>{step=slow?180001:1600;
   if(restoredFuture)snap=markers.map(x=>({...x}));
  },
  readMarkers,clock,monotonic:()=>step,allowDisposableRestore:true
 });
}
async function goodFixture(){
 const iam=await iamProof();
 const [boundaryProof,prReviewProof]=await Promise.all([
  boundary().inspect({commit,bundleSha256,iamProof:iam}),
  prAudit().inspect()
 ]);
 const prior={
  schemaVersion:1,sourceCommit:commit,sourceBundleSha256:bundleSha256,
  runId,sequence:3,nonce,
  iamEvidenceSha256:iam.evidenceSha256,
  recoveryDrillEvidenceSha256:'e'.repeat(64),
  sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
  decision:'NO_GO_INDEPENDENT_ATTESTATION_PENDING',
  productionAuthorized:false
 };
 prior.evidenceSha256=sha(prior);
 const r182Report={
  schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
  readinessProof:prior,iamProof:iam,
  drillProof:{evidenceSha256:prior.recoveryDrillEvidenceSha256},
  realPg17TwoNativeRestores:true,realPg17RlsAndNoGoAuditParity:true,
  realPg17RestoredDbReplayDenied:true,syntheticIamApiObservations:true,
  realIamRightsIndependentlyVerified:false,
  realProductionRpoRtoVerified:false,realGithubApproversVerified:false,
  productionAuthorized:false
 };
 const snapshot={
  ...r182Evidence,r182EvidenceSha256:prior.evidenceSha256
 };
 let markers=[],restored=[];
 const deltaProof=await createR183DeltaRecovery({
  readR182Witness:async()=>snapshot,
  quarantine:{status:async()=>({closed:true,generation:5})},
  writeBaseline:async x=>{markers.push(x);},
  dumpSource:async()=>{restored=[...markers];
   const b=Buffer.alloc(1024,0x52);b.write('PGDMP');return b;},
  writeAfterBackup:async x=>{markers.push(x);},
  restoreToIsolated:async()=>{},
  readMarkers:async db=>db==='postgres'?markers:restored,
  monotonic:(()=>{let n=0;return()=>n++===0?0:1650;})(),
  clock,allowDisposableRestore:true
 }).inspect({commit,bundleSha256,runId});
 return{r182Report,boundaryProof,prReviewProof,deltaProof,snapshot};
}
async function gate(options={}){
 const f=await goodFixture();let reads=0;
 const g=createR183PilotGate({
  readR182Witness:async()=>{
   reads++;return options.race&&reads>1?{
    ...f.snapshot,sequence:4
   }:{
    runId:f.snapshot.runId,sequence:f.snapshot.sequence,
    nonce:f.snapshot.nonce,sourceCommit:f.snapshot.sourceCommit,
    r182EvidenceSha256:f.snapshot.r182EvidenceSha256,
    decision:f.snapshot.decision,productionAuthorized:false
   };},
  quarantine:{status:async()=>({closed:!options.open,generation:5})},
  clock,allowInspect:true
 });
 const input={
  r182Report:f.r182Report,
  boundaryProof:options.falseBoundary?{
   ...f.boundaryProof,iamEffectivePermissionsIndependentlyVerified:true
  }:f.boundaryProof,
  prReviewProof:options.falsePr?{
   ...f.prReviewProof,approvedToDeploy:true
  }:f.prReviewProof,
  deltaProof:options.falseRpo?{
   ...f.deltaProof,productionDataLossMeasured:true
  }:f.deltaProof,
  commit,bundleSha256
 };
 return g.inspect(input);
}
test('R183 IAM default permissions boundaries match exact R178 role plans in both accounts',async()=>{
 const p=await iamProof(),r=await boundary().inspect({
  commit,bundleSha256,iamProof:p});
 assert.equal(r.twoDefaultBoundaryPolicyDocumentsMatched,true);
 assert.equal(r.iamEffectivePermissionsIndependentlyVerified,false);
 assert.equal(r.productionAuthorized,false);
 assert.match(r.evidenceSha256,/^[a-f0-9]{64}$/);
 for(const x of [{tamperBoundary:true},{wrongDefault:true},
  {expandPolicy:true},{missing:true}])
  await assert.rejects(boundary(x).inspect({
   commit,bundleSha256,iamProof:p}),/R183 IAM boundary/);
 for(const x of [{wrongTrust:true},{attached:true}])
  await assert.rejects(iamProof(x),/R182 IAM posture/);
});
test('R183 AWS IAM CLI has strict read-only boundary ARN/version, never accepts IAM writes',async()=>{
 const aws=createR181AwsCliExecutor();
 for(const operation of ['put-policy','delete-role','attach-role-policy'])
  await assert.rejects(aws({profile:'ci_source',region:'eu-west-1',
   service:'iam',operation,params:{}}),/R181 AWS read-only/);
 await assert.rejects(aws({profile:'ci_source',region:'eu-west-1',
  service:'iam',operation:'get-policy',
  params:{PolicyArn:'arn:aws:iam::111122223333:policy/AdministratorAccess'}}),
 /R181 AWS read-only/);
 await assert.rejects(aws({profile:'ci_source',region:'eu-west-1',
  service:'iam',operation:'get-policy-version',
  params:{PolicyArn:'arn:aws:iam::111122223333:policy/'+boundaryName,
   VersionId:'../../v1'}}),/R181 AWS read-only/);
});
test('R183 PR audit requires two current SHA reviews, a verified commit and no later rejection',async()=>{
 const a=await prAudit().inspect();
 assert.equal(a.reviewers.length,2);
 assert.equal(a.independentNaturalHumanIdentityVerified,false);
 assert.equal(a.productionAuthorized,false);
 for(const x of [{one:true},{self:true},{wrongSha:true},
  {badSignature:true},{rejected:true},{withdrawn:true},
  {changedSha:true},{unauthorized:true},{stale:true},
  {otherReview:true},{outOfDate:true}])
 await assert.rejects(prAudit(x).inspect(),/R183 GitHub PR review/,
  JSON.stringify(x));
});
test('R183 real-formatted synthetic PG17 delta snapshot exposes one intentionally missing postbackup event',async()=>{
 const r=await delta().inspect({commit,bundleSha256,runId});
 assert.equal(r.postBackupSourceMarkerCount,2);
 assert.equal(r.restoredSnapshotMarkerCount,1);
 assert.equal(r.intentionallyMissingPostBackupEvents,1);
 assert.equal(r.productionDataLossMeasured,false);
 assert.equal(r.productionAuthorized,false);
 for(const opts of [{postMissing:true},{restoredFuture:true},
  {invalidDump:true},{changedSource:true},{open:true},
  {slow:true},{baselineMissing:true}])
 await assert.rejects(delta(opts).inspect({commit,bundleSha256,runId}),
  /R183 delta drill/,JSON.stringify(opts));
});
test('R183 source-bound final pilot gate never permits real pilot or production GO',async()=>{
 const record=await gate();
 assert.equal(record.baselineMarkerSha256,sha('r183-base:'+commit+':'+runId));
 assert.equal(record.afterBackupMarkerSha256,sha('r183-late:'+commit+':'+runId));
 assert.equal(record.decision,'NO_GO_REAL_PILOT_EVIDENCE_PENDING');
 assert.equal(record.syntheticLostDeltaEvents,1);
 assert.equal(record.realPilotAuthorized,false);
 assert.equal(record.productionAuthorized,false);
 assert.match(record.evidenceSha256,/^[a-f0-9]{64}$/);
 for(const x of [{race:true},{open:true},{falseBoundary:true},
  {falsePr:true},{falseRpo:true}])
 await assert.rejects(gate(x),/R183 pilot gate/,JSON.stringify(x));
});
test('R183 PostgreSQL17 serializable holder binds R182 + two synthetic markers and refuses replay',async()=>{
 const p=await gate();
 const q=r183PilotSql(p);
 for(const token of ['SERIALIZABLE','marcosa_r183_writer',
  'r182_ci.recovery_readiness','r182_ci.readiness_audit',
  'r183_ci.synthetic_delta_markers','r183_ci.pilot_audit',
  'ON CONFLICT DO NOTHING'])
  assert.ok(q.includes(token),token);
 for(const change of [{decision:'PRODUCTION_GO'},
  {productionAuthorized:true},{sourceMode:'MANUAL_READONLY'},
  {syntheticLostDeltaEvents:0},{nonce:"' OR 1=1"},
  {sourceAccountId:offsite.accountId}])
  assert.throws(()=>r183PilotSql({...p,...change}),/R183 pilot ledger/);
 let n=0;
 const ledger=createR183PilotLedger({
  executeSql:async()=>n++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'
 });
 assert.equal((await ledger.record(p)).recorded,true);
 await assert.rejects(ledger.record(p),/R183 pilot ledger/);
 await assert.rejects(createR183PilotLedger({
  executeSql:async()=> 'BEGIN\n1|0\nCOMMIT'
 }).record(p),/R183 pilot ledger/);
});
