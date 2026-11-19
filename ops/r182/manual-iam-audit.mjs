/**
 * Operator-only real IAM read-only diagnostics. No CI invocation,
 * provider tokens in chat or key logging. Never changes AWS/GitHub/DB.
 *
 * Requires R182_ALLOW_READONLY=YES_NO_DEPLOY, two R181_* profiles,
 * R181_SOURCE_COMMIT, R181_BUNDLE_SHA256.
 *
 * AWS CLI v2 profiles must have read access to the two role documents.
 */
import {spawnSync} from 'node:child_process';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR181AwsCliExecutor} from '../r181/aws-readonly-cli.mjs';
import {createR182IamPostureAudit} from './iam-posture.mjs';
const env=process.env;
const fail=m=>{throw Error('R182 manual IAM: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
function required(key){
 const v=env['R181_'+key];
 ok(typeof v==='string'&&v.length>0&&v.length<=1024,
  'configuration missing: R181_'+key);
 return v;
}
async function main(){
 ok(process.argv.length===3&&process.argv[2]==='--read-only'&&
  env.R182_ALLOW_READONLY==='YES_NO_DEPLOY',
  'explicit --read-only and R182_ALLOW_READONLY required');
 ok(!env.GITHUB_ACTIONS&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  'manual real IAM probe must never run in GitHub Actions CI');
 const git=spawnSync('git',['rev-parse','HEAD'],{
  cwd:process.cwd(),encoding:'utf8',timeout:7000,maxBuffer:2048});
 ok(git.status===0&&!git.error&&
  git.stdout.trim()===required('SOURCE_COMMIT'),
  'checkout does not match reviewed exact R182 commit');
 const bundle=await buildR163Bundle({root:process.cwd(),
  commit:required('SOURCE_COMMIT')});
 ok(bundle.sha256===required('BUNDLE_SHA256'),
  'reproducible source hash differs from reviewed bundle');
 const make=prefix=>({
  profile:required(prefix+'_PROFILE'),
  region:required(prefix+'_REGION'),
  accountId:required(prefix+'_ACCOUNT_ID'),
  bucket:required(prefix+'_BUCKET'),
  kmsKeyArn:required(prefix+'_KMS_ARN')
 });
 const proof=await createR182IamPostureAudit({
  source:make('SOURCE'),offsite:make('OFFSITE'),
  executeAws:createR181AwsCliExecutor(),
  allowNetwork:true
 }).inspect({commit:required('SOURCE_COMMIT'),
  bundleSha256:required('BUNDLE_SHA256')});
 ok(proof.productionAuthorized===false,
  'IAM read-only result must never authorize deployment');
 const output={
  schemaVersion:1,scope:'manual-readonly-iam-configuration-inspection',
  commit:proof.commit,bundleSha256:proof.bundleSha256,
  sourceAccountId:proof.source.accountId,
  offsiteAccountId:proof.offsite.accountId,
  iamEvidenceSha256:proof.evidenceSha256,
  trustAndInlinePoliciesMatched:proof.exactTwoRoleReadOnlyShapeMatched,
  effectiveIamRightsIndependentlyVerified:false,
  permissionsBoundaryPolicyContentInspected:false,
  actualHumanReviewersVerified:false,
  decision:'NO_GO_INDEPENDENT_ATTESTATION_PENDING',
  productionAuthorized:false
 };
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
}
try{await main();}catch{
 // Do not print AWS CLI stderr, detailed environment, keys or secrets.
 process.stderr.write('R182_MANUAL_READONLY_IAM_NO_GO: not verified\n');
 process.exitCode=1;
}
