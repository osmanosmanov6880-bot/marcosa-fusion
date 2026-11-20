/** CI producer: ephemeral Ed25519 signer + offline HTML/Markdown and SHA manifest. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR193Fixture} from './fixture.mjs';
const env=process.env,hash=x=>createHash('sha256').update(x).digest('hex');
const ok=(v,m)=>{if(!v)throw Error('R193 producer: '+m);};
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 env.RUNNER_TEMP&&env.GITHUB_OUTPUT&&!env.PGHOST&&!env.PGPASSWORD&&
 !env.AWS_ACCESS_KEY_ID&&!env.AWS_SECRET_ACCESS_KEY&&
 !env.AWS_SESSION_TOKEN&&!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'isolated CI without database, secrets or AWS OIDC required');
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
ok(source===env.GITHUB_SHA,'HEAD SHA differs from checkout');
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=hash(tree);
const fixture=await buildR193Fixture({commit:source,bundleSha256,runId:944044});
const report=fixture.signed;
ok(report.bytes.length<130000&&report.signature.length===64&&
 report.rendered.html.length<180000&&report.rendered.markdown.length<30000,
 'bounded public proof or report required');
const dir=join(env.RUNNER_TEMP,'r193-producer');
await mkdir(dir,{mode:0o700,recursive:true});
for(const [name,data] of [
 ['signed-packet.json',report.bytes],
 ['signature.base64url',report.signature.toString('base64url')+'\n'],
 ['public.der.base64',fixture.publicKeyDer.toString('base64')+'\n'],
 ['index.html',report.rendered.html],
 ['report.md',report.rendered.markdown]
 ])await writeFile(join(dir,name),data,{flag:'wx',mode:0o600});
await appendFile(env.GITHUB_OUTPUT,[
 'packet_sha='+report.bundleFileSha256,
 'pub_sha='+report.publicKeySha256,
 'html_sha='+report.rendered.htmlSha256,
 'markdown_sha='+report.rendered.markdownSha256,
 'source_bundle_sha='+bundleSha256
].join('\n')+'\n');
console.log('R193_OFFLINE_MOBILE_AUDIT_DESK_AND_SIGNED_MANIFEST=PASS');
console.log('R193_CI_FIXTURE_EXTERNAL_OPERATOR_ATTESTATION=NO_GO');
