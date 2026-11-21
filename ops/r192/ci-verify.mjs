/** R192 independent second runner: verify full evidence and Ed25519 again.
 * Only public bytes and exact Git SHA. No database or external token access. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyR192KeyRotation} from './key-rotation.mjs';
import {assessR192ReviewDecision} from './review-decision.mjs';
import {assessR192AwsRisk} from './aws-risk.mjs';
import {assessR192Release,R192_NO_GO} from './release-verdict.mjs';
const e=process.env;
const fail=m=>{throw Error('R192 verifier: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 /^[a-f0-9]{64}$/.test(e.R192_PACKAGE_SHA||'')&&
 /^[a-f0-9]{64}$/.test(e.R192_OLD_REGISTRY_SHA||'')&&
 !e.PGHOST&&!e.PGPASSWORD&&!e.AWS_ACCESS_KEY_ID&&
 !e.AWS_SECRET_ACCESS_KEY&&!e.AWS_SESSION_TOKEN&&
 !e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'second runner must have no cloud or database credentials');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
ok(commit===e.GITHUB_SHA,'independent checkout SHA mismatched');
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
const bytes=await readFile(join(e.RUNNER_TEMP,'r192-independent','r192-public.json'));
ok(bytes.length>=3000&&bytes.length<=45000&&sha(bytes)===e.R192_PACKAGE_SHA,
 'public artifact changed in transit');
const p=JSON.parse(bytes.toString('utf8'));
ok(bytes.equals(Buffer.from(JSON.stringify(p)+'\n'))&&
 p.schemaVersion===1&&p.sourceMode==='CI_DISPOSABLE'&&
 p.sourceCommit===commit&&p.sourceBundleSha256===bundleSha256&&
 p.parentR191Commit==='534b65791b21b514b96894014def478352ba8a70'&&
 p.release?.decision===R192_NO_GO&&p.release?.productionAuthorized===false,
 'noncanonical or unauthorized source proof');
const clock=()=>p.release.observedAtMs;
const oldBytes=Buffer.from(p.oldRegistryBase64,'base64');
const newBytes=Buffer.from(p.newRegistryBase64,'base64');
ok(oldBytes.toString('base64')===p.oldRegistryBase64&&
 newBytes.toString('base64')===p.newRegistryBase64&&
 sha(oldBytes)===e.R192_OLD_REGISTRY_SHA&&
 p.oldRegistrySha256===e.R192_OLD_REGISTRY_SHA,
 'external old registry SHA pin mismatched');
const rotation=verifyR192KeyRotation({
 oldBytes,newBytes,expectedOldSha256:e.R192_OLD_REGISTRY_SHA,
 bundleSha256,challenge:p.challenge,signatures:p.signatures,clock});
ok(JSON.stringify(rotation)===JSON.stringify(p.rotation),
 'second runner Ed25519 signature replay verification disagrees');
const review=assessR192ReviewDecision({commit,bundleSha256,
 github:p.github,clock});
const iamRisk=assessR192AwsRisk({commit,bundleSha256,iam:p.iam,clock});
ok(JSON.stringify(review)===JSON.stringify(p.review)&&
 JSON.stringify(iamRisk)===JSON.stringify(p.iamRisk),
 'second runner GitHub/AWS receipt hashes differ');
const release=assessR192Release({
 commit,bundleSha256,parentR191Commit:p.parentR191Commit,
 review,rotation,iamRisk,clock
});
ok(JSON.stringify(release)===JSON.stringify(p.release)&&
 release.productionAuthorized===false&&
 release.blockers.includes('LIVE_STAGING_RECOVERY_NOT_MEASURED'),
 'independent release decision cannot be GO');
console.log('R192_SECOND_RUNNER_ED25519_REGISTRY_SOURCE_SHA_AND_NO_GO=PASS');
console.log('R192_REAL_OPERATOR_STAGING_IAM_TLS_PRIVACY=UNVERIFIED_NO_GO');
