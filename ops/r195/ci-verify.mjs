/** Isolated second runner: independently re-check Git tree, Ed25519,
 * historical source proofs, deterministic HTML/MD, six CSV/MD and manifest.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyR195SignedPackage} from './portable-package.mjs';
import {requireTrue,H64} from '../r190/common.mjs';
const e=process.env,sha=x=>createHash('sha256').update(x).digest('hex');
requireTrue(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 [e.R195_PACKET_SHA,e.R195_KEY_SHA,e.R195_HTML_SHA,e.R195_MARKDOWN_SHA,
  e.R195_HANDOFF_SHA,e.R195_TREE_SHA].every(x=>H64.test(x||''))&&
 !e.PGHOST&&!e.PGPASSWORD&&!e.AWS_ACCESS_KEY_ID&&
 !e.AWS_SECRET_ACCESS_KEY&&!e.AWS_SESSION_TOKEN&&
 !e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'second runner cannot carry cloud/db credentials or unpinned fields');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
requireTrue(commit===e.GITHUB_SHA&&bundleSha256===e.R195_TREE_SHA,
 'git source differs from first verifier');
const dir=join(e.RUNNER_TEMP,'r195-independent');
const [bytes,sig,key,html,markdown,manifestRaw]=await Promise.all([
 readFile(join(dir,'signed-packet.json')),
 readFile(join(dir,'signature.base64url'),'utf8'),
 readFile(join(dir,'public.der.base64'),'utf8'),
 readFile(join(dir,'index.html'),'utf8'),
 readFile(join(dir,'report.md'),'utf8'),
 readFile(join(dir,'handoffs','manifest.json'),'utf8')
]);
requireTrue(sig.endsWith('\n')&&key.endsWith('\n')&&
 Buffer.from(sig.trim(),'base64url').toString('base64url')===sig.trim()&&
 Buffer.from(key.trim(),'base64').toString('base64')===key.trim()&&
 sha(Buffer.from(html))===e.R195_HTML_SHA&&
 sha(Buffer.from(markdown))===e.R195_MARKDOWN_SHA,
 'public signature, SPKI DER, HTML or Markdown corrupted');
const result=verifyR195SignedPackage({
 bytes,signature:Buffer.from(sig.trim(),'base64url'),
 publicKeyDer:Buffer.from(key.trim(),'base64'),
 expectedPublicKeySha256:e.R195_KEY_SHA,
 expectedFileSha256:e.R195_PACKET_SHA,
 expectedDashboardSha256:e.R195_HTML_SHA,
 expectedMarkdownSha256:e.R195_MARKDOWN_SHA,
 expectedHandoffSha256:e.R195_HANDOFF_SHA,
 commit,bundleSha256,clock:()=>Date.now(),allowHistoricalCi:true
});
const full=JSON.parse(manifestRaw);
const {manifestSha256,...manifest}=full;
requireTrue(sha(JSON.stringify(manifest))===e.R195_HANDOFF_SHA&&
 manifestSha256===e.R195_HANDOFF_SHA&&
 manifest.decision==='NO_GO'&&manifest.productionAuthorized===false&&
 manifest.ownerHashes.length===6&&result.handoffCount===6,
 'handoff manifest altered or falsely approved');
for(const info of manifest.ownerHashes){
 requireTrue(['ENGINEERING','GOVERNANCE','DEVOPS','SECURITY',
  'OPERATIONS','PRIVACY'].includes(info.owner)&&
  Number.isSafeInteger(info.count)&&info.count>=1,
  'unknown owner in independent acceptance');
 const [md,csvRaw]=await Promise.all([
  readFile(join(dir,'handoffs',info.owner+'.md'),'utf8'),
  readFile(join(dir,'handoffs',info.owner+'.csv'),'utf8')
 ]);
 requireTrue(csvRaw.startsWith('\ufeff'),'role CSV BOM missing');
 const csv=csvRaw.slice(1);
 requireTrue(sha(Buffer.from(md))===info.markdownSha256&&
  sha(Buffer.from(csv))===info.csvSha256&&
  md.includes('NO-GO')&&csv.includes('"NO_GO"'),
  'independent owner CSV/Markdown SHA or immutable NO-GO changed');
}
requireTrue(result.verified===true&&result.productionAuthorized===false&&
 result.realPilotAuthorized===false,
 'independent signed source verification failed');
console.log('R195_SECOND_RUNNER_ED25519_SOURCE_SIX_HANDOFFS_HTML_AND_SHA_CHAIN=PASS');
console.log('R195_EXTERNAL_OPERATOR_PRODUCTION=NO_GO');
