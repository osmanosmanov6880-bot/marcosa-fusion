/**
 * Operator-only, explicitly opted-in REAL read-only IAM default boundary
 * and GitHub exact PR review diagnostics, with redacted output.
 * Does not touch DB, S3 objects, production, GitHub writes or deployment.
 * Never schedule this job in CI. No tokens in chat, files or reports.
 *
 * Required:
 * R183_ALLOW_READONLY=YES_NO_DEPLOY
 * R183_GH_READ_TOKEN
 * R183_REVIEWER_IDS="2002,3003"
 * R181_SOURCE_COMMIT, R181_BUNDLE_SHA256
 * R181_SOURCE_PROFILE, R181_SOURCE_REGION, R181_SOURCE_ACCOUNT_ID,
 * R181_SOURCE_BUCKET, R181_SOURCE_KMS_ARN
 * same keys prefixed R181_OFFSITE_
 */
import {spawnSync} from 'node:child_process';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR181AwsCliExecutor} from '../r181/aws-readonly-cli.mjs';
import {createR182IamPostureAudit} from '../r182/iam-posture.mjs';
import {createR183BoundaryAudit} from './boundary-policy.mjs';
import {createR183PrReviewAudit} from './github-pr-review.mjs';
const env=process.env;
const fail=m=>{throw Error('R183 manual preflight: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
function required(n){
 const v=env['R181_'+n];
 ok(typeof v==='string'&&v.length>0&&v.length<1024,
  'read-only configuration missing: R181_'+n);
 return v;
}
async function run(){
 ok(process.argv.length===3&&process.argv[2]==='--read-only'&&
  env.R183_ALLOW_READONLY==='YES_NO_DEPLOY'&&
  !env.GITHUB_ACTIONS&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  'real diagnostics require manual --read-only outside CI');
 ok(typeof env.R183_GH_READ_TOKEN==='string'&&
  env.R183_GH_READ_TOKEN.length>=12,
  'read-only GitHub PR API token missing');
 const commit=required('SOURCE_COMMIT');
 const current=spawnSync('git',['rev-parse','HEAD'],{
  encoding:'utf8',timeout:7000,maxBuffer:2048});
 ok(current.status===0&&!current.error&&current.stdout.trim()===commit,
  'exact approved checkout SHA required');
 const bundle=await buildR163Bundle({root:process.cwd(),commit});
 const bundleSha256=required('BUNDLE_SHA256');
 ok(bundle.sha256===bundleSha256,'source manifest differs from reviewed SHA');
 const scope=prefix=>({
  profile:required(prefix+'_PROFILE'),
  region:required(prefix+'_REGION'),
  accountId:required(prefix+'_ACCOUNT_ID'),
  bucket:required(prefix+'_BUCKET'),
  kmsKeyArn:required(prefix+'_KMS_ARN')
 });
 const source=scope('SOURCE'),offsite=scope('OFFSITE');
 const executeAws=createR181AwsCliExecutor();
 const iam=await createR182IamPostureAudit({source,offsite,
  executeAws,allowNetwork:true
 }).inspect({commit,bundleSha256});
 const expected=String(env.R183_REVIEWER_IDS||'').split(',').map(Number);
 const [boundary,pr]=await Promise.all([
  createR183BoundaryAudit({source,offsite,
   executeAws,allowNetwork:true
  }).inspect({commit,bundleSha256,iamProof:iam}),
  createR183PrReviewAudit({
   token:env.R183_GH_READ_TOKEN,reviewerIds:expected,
   commit,allowNetwork:true
  }).inspect()
 ]);
 ok(boundary.productionAuthorized===false&&
  pr.approvedToDeploy===false&&pr.productionAuthorized===false,
  'read-only evidence cannot authorize real pilot');
 process.stdout.write(JSON.stringify({
  schemaVersion:1,scope:'manual-readonly-iam-boundary-and-pr-inspection',
  commit,bundleSha256,
  defaultIamBoundaryEvidenceSha256:boundary.evidenceSha256,
  exactHeadPrReviewEvidenceSha256:pr.evidenceSha256,
  twoBoundaryDocumentsShapeMatched:true,
  twoHeadPrReviewEventsShapeMatched:true,
  realEffectiveIamRightsIndependentlyEstablished:false,
  realHumanIdentityIndependentlyEstablished:false,
  actualProductionRpoRtoEstablished:false,
  decision:'NO_GO_REAL_PILOT_EVIDENCE_PENDING',
  realPilotAuthorized:false,productionAuthorized:false
 },null,2)+'\n');
}
try{await run();}catch{
 // Never emit provider response, token, AWS CLI stderr or sensitive role data.
 process.stderr.write('R183_MANUAL_READONLY_NO_GO: verification incomplete\n');
 process.exitCode=1;
}
