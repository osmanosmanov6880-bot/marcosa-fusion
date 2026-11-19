/**
 * Second independent GitHub runner: verify new R169 proof and all source bytes.
 * No PostgreSQL, AWS credentials, or OIDC write permissions in this job.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
const fail=m=>{throw Error('R169 independent CI: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const env=process.env;
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.PGHOST&&!env.PGPASSWORD&&!env.AWS_ACCESS_KEY_ID&&
 !env.AWS_SECRET_ACCESS_KEY&&!env.AWS_SESSION_TOKEN,
 'independent isolated source-verifier with zero AWS/PostgreSQL credentials');
const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,'r169-report',
 'r169-operator-security-report.json'),'utf8'));
const keys=[
 'schemaVersion','commit','bundleSha256','encryptedSha256',
 'nativePostgres17Restore','roleAndPolicyScopedToFeatureBranch',
 'ephemeralSessionGuardExercised','twoSignatureEd25519ProofVerified',
 'nonceReplayRejectedInProcess','durablePostgresNonceFromR165VerifiedInSeparateCI',
 'quarantineReadFromPostgres17','awsKmsS3PostureExaminedThroughSimulatedClients',
 'sourceAndTargetSecurityInventoryEqual','noRealAwsCredentials',
 'noLiveSupabase','noExternalKmsPolicyAudit','productionAuthorized'
].sort().join(',');
ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
 Object.keys(report).sort().join(',')===keys&&
 report.schemaVersion===1&&report.commit===env.GITHUB_SHA&&
 /^[a-f0-9]{64}$/.test(report.bundleSha256||'')&&
 /^[a-f0-9]{64}$/.test(report.encryptedSha256||''),
 'strict SHA-bound nonsecret report required');
for(const key of [
 'nativePostgres17Restore','roleAndPolicyScopedToFeatureBranch',
 'ephemeralSessionGuardExercised','twoSignatureEd25519ProofVerified',
 'nonceReplayRejectedInProcess','durablePostgresNonceFromR165VerifiedInSeparateCI',
 'quarantineReadFromPostgres17',
 'awsKmsS3PostureExaminedThroughSimulatedClients',
 'sourceAndTargetSecurityInventoryEqual','noRealAwsCredentials',
 'noLiveSupabase','noExternalKmsPolicyAudit'
])ok(report[key]===true,'missing isolated contract evidence '+key);
ok(report.productionAuthorized===false,'production must remain blocked');
const bundle=await buildR163Bundle({root:process.cwd(),commit:env.GITHUB_SHA});
ok(bundle.sha256===report.bundleSha256,'second runner source bundle mismatch');
console.log('R169_SECOND_RUNNER_COMPLETE_SOURCE_AND_REPORT_REHASH=PASS');
console.log('R169_SYNTHETIC_AWS_AND_REAL_PG17_LAB_DISCLAIMER=PASS');
console.log('R169_NO_CLOUD_PRODUCTION_OR_EXTERNAL_KMS_SIGNOFF=PASS');
