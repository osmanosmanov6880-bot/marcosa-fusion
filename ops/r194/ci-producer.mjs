/** First isolated runner: genuine ephemeral Ed25519 signed, hashed offline HTML. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR194Fixture} from './fixture.mjs';
import {createR194Package} from './portable-package.mjs';
const e=process.env,sha=x=>createHash('sha256').update(x).digest('hex');
const ok=(v,m)=>{if(!v)throw Error('R194 producer: '+m);};
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 e.RUNNER_TEMP&&e.GITHUB_OUTPUT&&
 !e.PGHOST&&!e.PGPASSWORD&&
 !e.AWS_ACCESS_KEY_ID&&!e.AWS_SECRET_ACCESS_KEY&&
 !e.AWS_SESSION_TOKEN&&!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'isolated source-pinned no-secrets CI required');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
ok(commit===e.GITHUB_SHA,'git HEAD differs from CI SHA');
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
const f=await buildR194Fixture({commit,bundleSha256});
const signed=createR194Package({commit,bundleSha256,
 beforeIntake:f.before.intake,afterIntake:f.after.intake,
 beforeAssessment:f.before.assessment,afterAssessment:f.after.assessment,
 ledger:f.board,evidenceDelta:f.evidenceDelta,riskTrend:f.riskTrend,
 privateKey:f.keyPair.privateKey,publicKeyDer:f.publicKeyDer,
 clock:()=>f.now});
ok(signed.bytes.length<=200000&&signed.signature.length===64&&
 signed.rendered.html.length<=250000,
 'bounded public artifact required');
const folder=join(e.RUNNER_TEMP,'r194-producer');
await mkdir(folder,{recursive:true,mode:0o700});
for(const [name,data] of [
 ['index.html',signed.rendered.html],
 ['report.md',signed.rendered.markdown],
 ['signed-packet.json',signed.bytes],
 ['signature.base64url',signed.signature.toString('base64url')+'\n'],
 ['public.der.base64',f.publicKeyDer.toString('base64')+'\n']
 ])await writeFile(join(folder,name),data,{flag:'wx',mode:0o600});
await appendFile(e.GITHUB_OUTPUT,[
 'packet_sha='+signed.fileSha256,
 'key_sha='+signed.keySha256,
 'html_sha='+signed.rendered.htmlSha256,
 'markdown_sha='+signed.rendered.markdownSha256,
 'tree_sha='+bundleSha256
].join('\n')+'\n');
console.log('R194_REAL_ED25519_OFFLINE_MOBILE_WORKSPACE_ARTIFACT=PASS');
console.log('R194_ALL_EXTERNAL_APPROVAL_AND_PRODUCTION=NO_GO');
