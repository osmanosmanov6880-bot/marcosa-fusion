/**
 * R186 operator-only real GET/HEAD observations. No AWS or PG access.
 *
 * Requirements: reviewed exact checkout, Node 24, read-only GitHub
 * fine-grained token permitted to read PR/commit/environment endpoints.
 * Environment:
 * R186_ALLOW_READONLY=YES_NO_DEPLOY
 * R186_SOURCE_COMMIT=<40-char SHA>
 * R186_BUNDLE_SHA256=<64-char SHA>
 * R186_GH_READ_TOKEN=<GitHub read-only token>
 * R186_STAGING_HOST=<explicit staging.* FQDN>
 *
 * Do NOT place token in git, chat, CI artifacts or command line.
 * This script NEVER authorizes staging, changes GitHub/AWS or runs SQL.
 */
import {spawnSync} from 'node:child_process';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR186GithubPreflight} from './github-preflight.mjs';
import {createR186HttpsPreflight} from './https-preflight.mjs';
import {createR187PinnedHttpsTransport} from '../r187/pinned-https.mjs';
const env=process.env;
const fail=m=>{throw Error('R186 operator preflight: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
async function main(){
 ok(process.argv.length===3&&process.argv[2]==='--read-only'&&
  env.R186_ALLOW_READONLY==='YES_NO_DEPLOY'&&
  !env.GITHUB_ACTIONS&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  'operator-only manual read-only inspection; forbidden in CI');
 const commit=env.R186_SOURCE_COMMIT;
 const bundleSha256=env.R186_BUNDLE_SHA256;
 ok(/^[a-f0-9]{40}$/.test(commit||'')&&
  /^[a-f0-9]{64}$/.test(bundleSha256||''),
  'exact reviewed source/manifest pins required');
 const git=spawnSync('git',['rev-parse','HEAD'],{
  encoding:'utf8',timeout:7000,maxBuffer:2048});
 ok(!git.error&&git.status===0&&git.stdout.trim()===commit,
  'HEAD must match manually reviewed exact commit');
 const bundle=await buildR163Bundle({root:process.cwd(),commit});
 ok(bundle.sha256===bundleSha256,
  'pinned source checkout bundle differs from operator review');
 const github=await createR186GithubPreflight({
  token:env.R186_GH_READ_TOKEN,
  sourceMode:'OPERATOR_READONLY_UNATTESTED',
  allowNetwork:true
 }).inspect({commit,bundleSha256});
 const pinned=createR187PinnedHttpsTransport({
  hostname:env.R186_STAGING_HOST,allowNetwork:true
 });
 await pinned.initialize();
 const https=await createR186HttpsPreflight({
  hostname:env.R186_STAGING_HOST,fetcher:pinned.fetcher,
  sourceMode:'OPERATOR_READONLY_UNATTESTED',
  allowNetwork:true
 }).inspect({commit,bundleSha256});
 const output={
  schemaVersion:1,scope:'operator-manual-readonly-unattested',
  commit,bundleSha256,
  githubEvidenceSha256:github.evidenceSha256,
  githubEnvironmentConfigured:github.githubEnvironmentConfigured,
  githubReviewRulePresent:github.environmentReviewProtectionConfigured,
  githubApprovedHeadAccountsObserved:github.currentHeadUniqueApprovals,
  githubOutstandingChanges:github.currentHeadUnresolvedChanges,
  signedHeadObserved:github.verifiedSignedCommit,
  stagingHostname:https.hostname,
  stagingHealthChecks:https.checks,
  stagingAllHeadersAndHealthPassed:https.healthAndSecurityPassed,
  actualGithubHumanIdentityIndependentlyVerified:false,
  actualAwsEffectiveRightsVerified:false,
  productionRecoveryMeasured:false,
  decision:'NO_GO_INDEPENDENT_STAGING_EVIDENCE_PENDING',
  realPilotAuthorized:false,productionAuthorized:false
 };
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
}
try{await main();}catch{
 // Never print token, headers, network response, host trace or PII.
 process.stderr.write('R186_OPERATOR_READONLY_NO_GO: verification incomplete\n');
 process.exitCode=1;
}
