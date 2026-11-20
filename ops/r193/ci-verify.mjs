/** Independent CI runner: verify Ed25519, packet, git source and both reports. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyR193SignedPackage} from './signed-package.mjs';
import {H64,requireTrue} from '../r190/common.mjs';
const env=process.env,sha=b=>createHash('sha256').update(b).digest('hex');
requireTrue(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 [env.R193_PACKET_SHA,env.R193_PUB_SHA,env.R193_HTML_SHA,
  env.R193_MARKDOWN_SHA,env.R193_SOURCE_BUNDLE_SHA].every(x=>H64.test(x||''))&&
 !env.PGHOST&&!env.PGPASSWORD&&!env.AWS_ACCESS_KEY_ID&&
 !env.AWS_SECRET_ACCESS_KEY&&!env.AWS_SESSION_TOKEN&&
 !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'independent second runner requires public artifact and pinned hashes only');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
requireTrue(commit===env.GITHUB_SHA&&bundleSha256===env.R193_SOURCE_BUNDLE_SHA,
 'source SHA/git-tree differs from producer');
const dir=join(env.RUNNER_TEMP,'r193-independent');
const [bytes,signatureString,publicKeyString,html,markdown]=await Promise.all([
 readFile(join(dir,'signed-packet.json')),
 readFile(join(dir,'signature.base64url'),'utf8'),
 readFile(join(dir,'public.der.base64'),'utf8'),
 readFile(join(dir,'index.html'),'utf8'),
 readFile(join(dir,'report.md'),'utf8')
]);
requireTrue(signatureString.endsWith('\n')&&publicKeyString.endsWith('\n'),
 'canonical public signature/key file required');
const sigText=signatureString.trim(),keyText=publicKeyString.trim();
const signature=Buffer.from(sigText,'base64url');
const publicKeyDer=Buffer.from(keyText,'base64');
requireTrue(signature.toString('base64url')===sigText&&
 publicKeyDer.toString('base64')===keyText&&
 sha(Buffer.from(html,'utf8'))===env.R193_HTML_SHA&&
 sha(Buffer.from(markdown,'utf8'))===env.R193_MARKDOWN_SHA,
 'public key, signature or HTML/Markdown changed in transit');
const result=verifyR193SignedPackage({
 bytes,signature,publicKeyDer,
 expectedPublicKeySha256:env.R193_PUB_SHA,
 expectedBundleFileSha256:env.R193_PACKET_SHA,
 expectedHtmlSha256:env.R193_HTML_SHA,
 expectedMarkdownSha256:env.R193_MARKDOWN_SHA,
 commit,bundleSha256,clock:()=>Date.now(),allowHistoricalCi:true
});
requireTrue(result.verified===true&&
 result.decision==='NO_GO_EXTERNAL_OPERATOR_VERIFICATION_REQUIRED'&&
 result.productionAuthorized===false&&result.realPilotAuthorized===false,
 'replayed evidence was not valid NO-GO');
console.log('R193_SECOND_RUNNER_ED25519_SOURCE_AND_DASHBOARD_REPLAY=PASS');
console.log('R193_EXTERNAL_OPERATOR_AND_PRODUCTION_READINESS=UNVERIFIED');
