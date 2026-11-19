/**
 * R181 optional operator-side read-only provider probe; NEVER CI automated.
 * Usage after setting environment variables: node ops/r181/manual-preflight.mjs --read-only
 * No secret values, AWS object bytes, tokens or credentials are printed.
 * No GitHub writes, AWS writes, PostgreSQL writes, deployment or rollout.
 */
import {spawnSync} from 'node:child_process';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR181GithubPolicyInspector}
 from './github-policy-inspector.mjs';
import {createR181AwsCliExecutor,createR181AwsReadOnlyProbe}
 from './aws-readonly-cli.mjs';
const env=process.env;
const fail=m=>{throw Error('R181 manual preflight: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const required=x=>{
 const v=env['R181_'+x];
 ok(typeof v==='string'&&v.length>0&&v.length<=4096,
  'missing required nonsecret configuration: R181_'+x);
 return v;
};
const num=x=>{
 const v=Number(required(x));
 ok(Number.isSafeInteger(v)&&v>0,'invalid integer field: R181_'+x);
 return v;
};
async function main(){
 ok(process.argv.length===3&&process.argv[2]==='--read-only'&&
  env.R181_ALLOW_READONLY==='YES_MANUAL_NO_DEPLOY',
  'explicit --read-only and R181_ALLOW_READONLY required');
 ok(typeof env.R181_GH_READ_TOKEN==='string'&&
  env.R181_GH_READ_TOKEN.length>=12,
  'read-only GitHub token missing; do not paste tokens into chat');
 const git=spawnSync('git',['rev-parse','HEAD'],{
  cwd:process.cwd(),encoding:'utf8',timeout:6000,
  maxBuffer:2048});
 ok(!git.error&&git.status===0,'local Git revision unavailable');
 const commit=required('SOURCE_COMMIT');
 ok(git.stdout.trim()===commit,
  'checkout differs from requested source commit');
 const bundle=await buildR163Bundle({root:process.cwd(),commit});
 const expectedBundle=required('BUNDLE_SHA256');
 ok(bundle.sha256===expectedBundle,
  'source files or manifest differ from reviewed SHA');
 const runId=num('GITHUB_RUN_ID'),actorId=num('GITHUB_ACTOR_ID');
 const reviewerIds=required('REVIEWER_IDS').split(',').map(Number);
 const github=createR181GithubPolicyInspector({
  token:env.R181_GH_READ_TOKEN,runId,commit,actorId,reviewerIds,
  allowNetwork:true});
 const source={profile:required('SOURCE_PROFILE'),
  region:required('SOURCE_REGION'),
  accountId:required('SOURCE_ACCOUNT_ID'),
  bucket:required('SOURCE_BUCKET'),
  kmsKeyArn:required('SOURCE_KMS_ARN')};
 const offsite={profile:required('OFFSITE_PROFILE'),
  region:required('OFFSITE_REGION'),
  accountId:required('OFFSITE_ACCOUNT_ID'),
  bucket:required('OFFSITE_BUCKET'),
  kmsKeyArn:required('OFFSITE_KMS_ARN')};
 const aws=createR181AwsReadOnlyProbe({
  source,offsite,executeAws:createR181AwsCliExecutor(),
  allowNetwork:true});
 const args={commit,bundleSha256:expectedBundle,
  historyRootSha256:required('HISTORY_ROOT_SHA256'),
  sha256:required('APPLICATION_ENCRYPTED_OBJECT_SHA256'),
  sourceVersionId:required('SOURCE_VERSION_ID'),
  offsiteVersionId:required('OFFSITE_VERSION_ID')};
 const [g,a]=await Promise.all([github.inspect(),aws.inspect(args)]);
 ok(g.commit===commit&&a.commit===commit&&
  a.bundleSha256===bundle.sha256&&
  g.productionAuthorized===false&&a.productionAuthorized===false,
  'external read-only evidence is not pinned to source');
 process.stdout.write(JSON.stringify({
  schemaVersion:1,scope:'manual-readonly-observation',
  sourceCommit:commit,sourceBundleSha256:bundle.sha256,
  githubEvidenceSha256:g.evidenceSha256,
  awsEvidenceSha256:a.evidenceSha256,
  githubReviewEventsShapeMatched:g.twoDistinctReviewEventsShapeMatched,
  awsTwoAccountVersionReadbackShapeMatched:
   a.fullTwoAccountVersionReadbackShapeMatched,
  independentHumanAndProviderAttestation:false,
  effectiveIamAndProductionRpoRtoVerified:false,
  decision:'NO_GO_PROVIDER_ATTESTATION_PENDING',
  productionAuthorized:false
 },null,2)+'\n');
}
try{await main();}catch(e){
 // No exception stack, tokens or CLI stderr are ever printed.
 process.stderr.write('R181_READONLY_FAILED_NO_GO: '+
  String(e?.message||'unavailable')+'\n');
 process.exitCode=1;
}
