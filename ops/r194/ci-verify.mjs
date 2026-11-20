/** Second runner: independent cryptographic, provenance and HTML/MD replay. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyR194Package} from './portable-package.mjs';
import {H64,requireTrue} from '../r190/common.mjs';
const e=process.env,sha=x=>createHash('sha256').update(x).digest('hex');
requireTrue(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 [e.R194_PACKET_SHA,e.R194_KEY_SHA,e.R194_HTML_SHA,
  e.R194_MARKDOWN_SHA,e.R194_TREE_SHA].every(x=>H64.test(x||''))&&
 !e.PGHOST&&!e.PGPASSWORD&&!e.AWS_ACCESS_KEY_ID&&
 !e.AWS_SECRET_ACCESS_KEY&&!e.AWS_SESSION_TOKEN&&
 !e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'independent CI runner requires exact SHA pins and no provider secrets');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
requireTrue(commit===e.GITHUB_SHA&&bundleSha256===e.R194_TREE_SHA,
 'source tree changed between first and second runner');
const dir=join(e.RUNNER_TEMP,'r194-independent');
const [bytes,sig,key,html,markdown]=await Promise.all([
 readFile(join(dir,'signed-packet.json')),
 readFile(join(dir,'signature.base64url'),'utf8'),
 readFile(join(dir,'public.der.base64'),'utf8'),
 readFile(join(dir,'index.html'),'utf8'),
 readFile(join(dir,'report.md'),'utf8')
]);
const sigText=sig.trim(),keyText=key.trim();
requireTrue(sig.endsWith('\n')&&key.endsWith('\n')&&
 sigText.length>80&&keyText.length>55,
 'detached signature and public DER not canonical');
const signature=Buffer.from(sigText,'base64url');
const der=Buffer.from(keyText,'base64');
requireTrue(signature.toString('base64url')===sigText&&
 der.toString('base64')===keyText&&
 sha(Buffer.from(html,'utf8'))===e.R194_HTML_SHA&&
 sha(Buffer.from(markdown,'utf8'))===e.R194_MARKDOWN_SHA,
 'transferred signed report or public key altered');
const result=verifyR194Package({
 bytes,signature,publicKeyDer:der,
 expectedPublicKeySha256:e.R194_KEY_SHA,
 expectedFileSha256:e.R194_PACKET_SHA,
 expectedHtmlSha256:e.R194_HTML_SHA,
 expectedMarkdownSha256:e.R194_MARKDOWN_SHA,
 commit,bundleSha256,clock:()=>Date.now(),allowHistoricalCi:true
});
requireTrue(result.verified===true&&result.productionAuthorized===false&&
 result.realPilotAuthorized===false,
 'failed cryptographic re-validation or false production clearance');
console.log('R194_SECOND_RUNNER_ED25519_EVIDENCE_CHAIN_AND_MOBILE_UI_REPLAY=PASS');
console.log('R194_REAL_HUMAN_AWS_TLS_PRIVACY_PRODUCTION=NO_GO');
