/**
 * R184 operator-only real AWS/GitHub READ-ONLY diagnostics.
 * Runs only after explicit manual opt-in on exact Git SHA.
 *
 * Requires AWS CLI v2 configured with two independently authorized read-only
 * audit profiles (GetRole, ListRolePolicies, GetRolePolicy, GetPolicy,
 * GetPolicyVersion, SimulatePrincipalPolicy); GitHub token with read access
 * to PR #168 review history and signed commits.
 *
 * Environment:
 * R184_ALLOW_READONLY=YES_NO_DEPLOY
 * R184_GH_READ_TOKEN; R184_REVIEWER_IDS="2002,3003"
 * R181_SOURCE_COMMIT, R181_BUNDLE_SHA256
 * R181_SOURCE_PROFILE, REGION, ACCOUNT_ID, BUCKET, KMS_ARN
 * R181_OFFSITE_PROFILE, REGION, ACCOUNT_ID, BUCKET, KMS_ARN
 *
 * No read-only observation can authorize a real pilot or production.
 * Never executes in GitHub Actions CI. Never prints credentials/policy text.
 */
import {spawnSync} from 'node:child_process';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR181AwsCliExecutor} from '../r181/aws-readonly-cli.mjs';
import {createR182IamPostureAudit} from '../r182/iam-posture.mjs';
import {createR183BoundaryAudit} from '../r183/boundary-policy.mjs';
import {createR184IamDenyProbe} from './iam-deny-simulation.mjs';
import {createR184ReviewHistory} from './review-history.mjs';
const env=process.env;
const fail=m=>{throw Error('R184 read-only manual preflight: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
function get(k){
 const v=env['R181_'+k];
 ok(typeof v==='string'&&v.length>0&&v.length<1024,
  'missing bounded R181_'+k);
 return v;
}
async function main(){
 ok(process.argv.length===3&&process.argv[2]==='--read-only'&&
  env.R184_ALLOW_READONLY==='YES_NO_DEPLOY'&&
  !env.GITHUB_ACTIONS&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN&&
  !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
  !env.AWS_SESSION_TOKEN,
  'real audit must be explicit manual read-only outside CI/OIDC/inline keys');
 ok(typeof env.R184_GH_READ_TOKEN==='string'&&
  env.R184_GH_READ_TOKEN.length>=12,
  'read-only GitHub token missing');
 const commit=get('SOURCE_COMMIT'),bundleSha256=get('BUNDLE_SHA256');
 const rev=spawnSync('git',['rev-parse','HEAD'],{
  encoding:'utf8',timeout:7000,maxBuffer:2048});
 ok(!rev.error&&rev.status===0&&rev.stdout.trim()===commit,
  'checkout must match exact code-reviewed commit');
 const bundle=await buildR163Bundle({root:process.cwd(),commit});
 ok(bundle.sha256===bundleSha256,
  'local source registry and independently reviewed bundle do not match');
 const scope=x=>({
  profile:get(x+'_PROFILE'),region:get(x+'_REGION'),
  accountId:get(x+'_ACCOUNT_ID'),bucket:get(x+'_BUCKET'),
  kmsKeyArn:get(x+'_KMS_ARN')
 });
 const source=scope('SOURCE'),offsite=scope('OFFSITE');
 const executeAws=createR181AwsCliExecutor();
 const iam=await createR182IamPostureAudit({source,offsite,
  executeAws,allowNetwork:true}).inspect({commit,bundleSha256});
 const boundary=await createR183BoundaryAudit({source,offsite,
  executeAws,allowNetwork:true}).inspect({commit,bundleSha256,
  iamProof:iam});
 const reviewerIds=String(env.R184_REVIEWER_IDS||'')
  .split(',').map(Number);
 const [deny,review]=await Promise.all([
  createR184IamDenyProbe({source,offsite,
   executeAws,allowNetwork:true
  }).inspect({commit,bundleSha256,iamProof:iam,boundaryProof:boundary}),
  createR184ReviewHistory({
   token:env.R184_GH_READ_TOKEN,
   reviewerIds,commit,allowNetwork:true
  }).inspect()
 ]);
 ok(deny.allSimulatedWriteActionsDenied===true&&
  review.completeHeadReviewHistoryInspected===true&&
  deny.productionAuthorized===false&&review.productionAuthorized===false,
  'read-only diagnostics cannot issue staging GO');
 process.stdout.write(JSON.stringify({
  schemaVersion:1,sourceCommit:commit,
  sourceBundleSha256:bundleSha256,
  providerMode:'OPERATOR_READONLY_UNATTESTED',
  paginatedPrReviewEvidenceSha256:review.evidenceSha256,
  simulatedIamDenyEvidenceSha256:deny.evidenceSha256,
  simulatedDeniedWriteProbes:deny.totalForbiddenWriteActionsChecked,
  effectiveIamPermissionsIndependentlyAttested:false,
  realHumanIdentityIndependentlyVerified:false,
  realProductionRecoveryMeasured:false,
  decision:'NO_GO_REAL_STAGING_EVIDENCE_PENDING',
  realPilotAuthorized:false,productionAuthorized:false
 },null,2)+'\n');
}
try{await main();}catch{
 process.stderr.write('R184_MANUAL_READONLY_NO_GO: independent verification incomplete\n');
 process.exitCode=1;
}
