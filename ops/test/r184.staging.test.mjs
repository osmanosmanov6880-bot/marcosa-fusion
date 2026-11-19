import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createR184ReviewHistory} from '../r184/review-history.mjs';
import {createR184IamDenyProbe,R184_FORBIDDEN_ACTIONS}
 from '../r184/iam-deny-simulation.mjs';
import {createR184ContinuityWindow} from '../r184/continuity-window.mjs';
import {createR184PilotReadiness} from '../r184/pilot-readiness.mjs';
import {r184PilotSql,createR184PilotLedger}
 from '../r184/pilot-ledger.mjs';
import {createR181AwsCliExecutor} from '../r181/aws-readonly-cli.mjs';
const sha=x=>createHash('sha256').update(
 typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const now=1800000000000,clock=()=>now,
 commit='a'.repeat(40),bundleSha256='b'.repeat(64),
 runId=123456789,nonce='c'.repeat(32);
const userIds=[2002,3003],authorId=1001;
const source={profile:'source_ci',region:'eu-west-1',
 accountId:'111122223333',bucket:'marcosa-source-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab'};
const offsite={profile:'offsite_ci',region:'eu-central-1',
 accountId:'444455556666',bucket:'marcosa-offsite-r178-ci',
 kmsKeyArn:'arn:aws:kms:eu-central-1:444455556666:key/4567abcd-12ab-34cd-56ef-1234567890ab'};
const iamRole=x=>'arn:aws:iam::'+x.accountId+
 ':role/marcosa-r178-readonly-auditor';
const iamProof={schemaVersion:1,commit,bundleSha256,
 exactTwoRoleReadOnlyShapeMatched:true,
 source:{accountId:source.accountId,roleArn:iamRole(source),
  exactRoleTrustAndInlinePolicyObserved:true},
 offsite:{accountId:offsite.accountId,roleArn:iamRole(offsite),
  exactRoleTrustAndInlinePolicyObserved:true},
 effectiveIamRightsIndependentlyVerified:false,
 productionAuthorized:false,evidenceSha256:'d'.repeat(64)};
const boundaryProof={schemaVersion:1,commit,bundleSha256,
 iamEvidenceSha256:iamProof.evidenceSha256,
 twoDefaultBoundaryPolicyDocumentsMatched:true,
 iamEffectivePermissionsIndependentlyVerified:false,
 productionAuthorized:false,evidenceSha256:'e'.repeat(64)};
const event=(id,state='COMMENTED')=>({
 id,user:{id:id+10000,type:'User'},state,
 commit_id:commit,submitted_at:new Date(now-2000).toISOString()
});
function gh({hiddenRejection=false,one=false,paginated=true,
 wrongCommit=false,apiDenied=false,overLimit=false}={}){
 const events=Array.from({length:98},(_,i)=>event(i+1));
 events.push({id:9901,user:{id:userIds[0],type:'User'},
  state:'APPROVED',commit_id:commit,
  submitted_at:new Date(now-1000).toISOString()});
 if(!one)events.push({id:9902,user:{id:userIds[1],type:'User'},
  state:'APPROVED',commit_id:commit,
  submitted_at:new Date(now-900).toISOString()});
 if(!one)for(let i=0;i<20;i++)events.push(event(400+i));
 if(hiddenRejection)events.push({
  id:9988,user:{id:userIds[0],type:'User'},
  state:'CHANGES_REQUESTED',commit_id:commit,
  submitted_at:new Date(now-500).toISOString()});
 const pr={number:168,state:'open',draft:false,
  user:{id:authorId,type:'User'},
  head:{sha:wrongCommit?'f'.repeat(40):commit,
   ref:'feature/marcosa-r150-growth-economics',
   repo:{full_name:'osmanosmanov6880-bot/marcosa-fusion'}},
  base:{ref:'feature/series-pilot-r149',
   repo:{full_name:'osmanosmanov6880-bot/marcosa-fusion'}}};
 const signed={sha:commit,
  commit:{committer:{date:new Date(now-5000).toISOString()},
   verification:{verified:true}}};
 const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET');
  const m=/page=(\d+)$/.exec(url);
  if(apiDenied&&m)return{status:403,headers:{get:()=> 'application/json'},
   text:async()=> '{"error":"denied"}'};
  const data=m?overLimit?events.slice(0,100):
   paginated?events.slice((Number(m[1])-1)*100,Number(m[1])*100):
   Number(m[1])===1?events.slice(0,100):null:
   url.includes('/commits/')?signed:pr;
  return{status:200,headers:{get:()=> 'application/json'},
   text:async()=>JSON.stringify(data)};
 };
 return createR184ReviewHistory({
  fetcher,token:'synthetic-github-token',
  reviewerIds:userIds,commit,clock,allowNetwork:true});
}
function deny({allowed=false,wrongResource=false,missingContext=false,
  missingPage=false,deniedApi=false}={}){
 const executeAws=async({profile,service,operation,params})=>{
  assert.equal(service,'iam');
  assert.equal(operation,'simulate-principal-policy');
  const t=profile===source.profile?source:offsite;
  assert.equal(params.PolicySourceArn,iamRole(t));
  if(deniedApi)throw Error('403');
  return{json:{IsTruncated:missingPage,
   EvaluationResults:[{
    EvalActionName:params.ActionNames,
    EvalResourceName:wrongResource?'arn:aws:s3:::other':params.ResourceArns,
    EvalDecision:allowed?'allowed':'implicitDeny',
    MissingContextValues:missingContext?['aws:SourceVpc']:[],
    ResourceSpecificResults:[]
   }]}};
 };
 return createR184IamDenyProbe({
  source,offsite,executeAws,clock,allowNetwork:true});
}
const snapshot={runId,sequence:3,nonce,sourceCommit:commit,
 r183EvidenceSha256:'f'.repeat(64),
 decision:'NO_GO_REAL_PILOT_EVIDENCE_PENDING',
 rlsEnforced:true,productionAuthorized:false};
function continuity({missingLate=false,futureRestore=false,
  badWal=false,sourceDrift=false,badSnapshot=false,open=false}={}){
 let original=[],restored=[],tick=100;
 return createR184ContinuityWindow({
  readR183Witness:async db=>sourceDrift&&
   db==='postgres'&&original.length===32?{
    ...snapshot,sequence:4}:snapshot,
  readQuarantine:async()=>({closed:!open,generation:5}),
  readEvents:async db=>db==='postgres'?
   original.map(x=>({...x})):restored.map(x=>({...x})),
  writeEvents:async(rows,stage)=>{
   if(stage==='AFTER_SNAPSHOT'&&missingLate)return;
   original.push(...rows);
  },
  dumpSource:async()=>{restored=[...original];const b=Buffer.alloc(1024,0x45);
   if(!badSnapshot)b.write('PGDMP');return b;},
  restoreToIsolated:async()=>{if(futureRestore)restored=[...original];
   tick=1700;},
  readWalPosition:async()=> '0/1F',
  readWalGrowth:async()=>badWal?0:4096,
  monotonic:()=>tick,clock,allowDisposableRestore:true
 });
}
async function packet(){
 const reviewer=await gh().inspect();
 const sim=await deny().inspect({commit,bundleSha256,iamProof,boundaryProof});
 const continuityProof=await continuity().inspect({commit,bundleSha256,runId});
 const prior={schemaVersion:1,sourceCommit:commit,
  sourceBundleSha256:bundleSha256,sourceMode:'CI_SYNTHETIC',
  runId,sequence:3,nonce,
  sourceAccountId:source.accountId,offsiteAccountId:offsite.accountId,
  decision:'NO_GO_REAL_PILOT_EVIDENCE_PENDING',
  realPilotAuthorized:false,productionAuthorized:false};
 prior.evidenceSha256=sha(prior);
 const r183={
  schemaVersion:1,commit,sourceBundleSha256:bundleSha256,
  pilotProof:prior,
  r182Report:{iamProof},boundaryProof,
  realPg17DeltaSnapshotRestored:true,
  realPg17NoGoAndRlsRestored:true,realPg17ReplayDenied:true,
  syntheticAwsBoundaryDocuments:true,
  syntheticGithubPrReviewEvents:true,
  realAwsRightsVerified:false,realPrReviewersVerified:false,
  realProductionRpoRtoVerified:false,realPilotAuthorized:false,
  productionAuthorized:false
 };
 // Bind the previous observation to the new disposable continuity proof
 const {evidenceSha256:old,...rest}=continuityProof;
 const linked={...rest,r183EvidenceSha256:prior.evidenceSha256};
 const rebound={...linked,evidenceSha256:sha(linked)};
 return{reviewer,sim,continuityProof:rebound,r183,prior};
}
async function gate(options={}){
 const p=await packet();let n=0;
 const g=createR184PilotReadiness({
  readR183Hold:async()=>{n++;return{
   runId,sequence:options.race&&n>1?4:3,nonce,
   sourceCommit:commit,r183EvidenceSha256:p.prior.evidenceSha256,
   decision:'NO_GO_REAL_PILOT_EVIDENCE_PENDING',
   productionAuthorized:false};},
  quarantine:{status:async()=>({closed:!options.open,generation:5})},
  clock,allowInspect:true});
 return g.inspect({
  r183Report:p.r183,
  reviewProof:options.fakeReview?{...p.reviewer,realPilotAuthorized:true}:
   p.reviewer,
  iamDenyProof:options.fakeIam?{...p.sim,actualEffectiveIamRightsVerified:true}:
   p.sim,
  continuityProof:options.fakeRpo?{...p.continuityProof,realProductionRpoRtoVerified:true}:
   p.continuityProof,
  commit,bundleSha256
 });
}
test('R184 examines >100 PR reviews and rejects hidden late CHANGES_REQUESTED',async()=>{
 const r=await gh().inspect();
 assert.equal(r.pageCount,2);
 assert.equal(r.reviewEventCount,120);
 assert.equal(r.reviewers.length,2);
 assert.equal(r.completeHeadReviewHistoryInspected,true);
 assert.equal(r.productionAuthorized,false);
 for(const x of [{hiddenRejection:true},{one:true},
  {paginated:false},{wrongCommit:true},{apiDenied:true},
  {overLimit:true}])
 await assert.rejects(gh(x).inspect(),/R184 paginated PR review/,
  JSON.stringify(x));
});
test('R184 evaluates 20 forbidden IAM writes; allow or partial simulation is NO-GO',async()=>{
 const r=await deny().inspect({commit,bundleSha256,iamProof,boundaryProof});
 assert.equal(R184_FORBIDDEN_ACTIONS.length,10);
 assert.equal(r.totalForbiddenWriteActionsChecked,20);
 assert.equal(r.allSimulatedWriteActionsDenied,true);
 assert.equal(r.actualEffectiveIamRightsVerified,false);
 for(const x of [{allowed:true},{wrongResource:true},
  {missingContext:true},{missingPage:true},{deniedApi:true}])
 await assert.rejects(deny(x).inspect({commit,bundleSha256,iamProof,boundaryProof}),
  /R184 IAM deny simulation/,JSON.stringify(x));
 const cli=createR181AwsCliExecutor();
 await assert.rejects(cli({service:'iam',operation:'simulate-principal-policy',
  profile:'source_ci',region:'eu-west-1',
  params:{PolicySourceArn:iamRole(source),
   ActionNames:'s3:*',ResourceArns:'*'}}),
 /R181 AWS read-only/);
});
test('R184 native-formatted 8+24 WAL window preserves exactly the snapshot',async()=>{
 const r=await continuity().inspect({commit,bundleSha256,runId});
 assert.equal(r.sourceEventCount,32);
 assert.equal(r.restoredSnapshotEventCount,8);
 assert.equal(r.intentionallyExcludedPostSnapshotEvents,24);
 assert.equal(r.observedSourcePostSnapshotWalBytes,4096);
 assert.equal(r.realProductionRpoRtoVerified,false);
 for(const x of [{missingLate:true},{futureRestore:true},
  {badWal:true},{sourceDrift:true},{badSnapshot:true},{open:true}])
 await assert.rejects(continuity(x).inspect({commit,bundleSha256,runId}),
 /R184 continuity window/,JSON.stringify(x));
});
test('R184 source-bound final hold rejects false production credentials and stale R183',async()=>{
 const p=await gate();
 assert.equal(p.decision,'NO_GO_REAL_STAGING_EVIDENCE_PENDING');
 assert.equal(p.intentionallyMissingEvents,24);
 assert.equal(p.realPilotAuthorized,false);
 assert.equal(p.productionAuthorized,false);
 assert.match(p.evidenceSha256,/^[a-f0-9]{64}$/);
 for(const x of [{fakeReview:true},{fakeIam:true},{fakeRpo:true},
  {race:true},{open:true}])
 await assert.rejects(gate(x),/R184 pilot readiness/,JSON.stringify(x));
});
test('R184 serializable PG17 one-use hold requires R183 and exact 8+24 events',async()=>{
 const packet=await gate();
 const sql=r184PilotSql(packet);
 for(const text of ['SERIALIZABLE','marcosa_r184_writer',
  'r183_ci.pilot_holds','r183_ci.pilot_audit',
  'r184_ci.synthetic_continuity_events',
  "AND e.phase='BASELINE'","AND e.phase='AFTER_SNAPSHOT'",
  'ON CONFLICT DO NOTHING','r184_ci.pilot_audit'])
 assert.ok(sql.includes(text),text);
 for(const change of [{decision:'PRODUCTION_GO'},
  {productionAuthorized:true},{sourceMode:'MANUAL_READONLY'},
  {intentionallyMissingEvents:0},{nonce:"' OR 1=1"},
  {sourceAccountId:offsite.accountId}])
 assert.throws(()=>r184PilotSql({...packet,...change}),
  /R184 pilot ledger/);
 let n=0;
 const ledger=createR184PilotLedger({
  executeSql:async()=>n++===0?'BEGIN\n1|1\nCOMMIT':'BEGIN\n0|0\nCOMMIT'
 });
 assert.equal((await ledger.record(packet)).recorded,true);
 await assert.rejects(ledger.record(packet),/R184 pilot ledger/);
});
