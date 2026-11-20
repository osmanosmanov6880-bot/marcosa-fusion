/** Isolated first runner: real ephemeral Ed25519, full source-bound
 * offline HTML, six human handoff files, and public SHA pins. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR194Fixture} from '../r194/fixture.mjs';
import {createR195SignedPackage} from './portable-package.mjs';
const e=process.env,sha=x=>createHash('sha256').update(x).digest('hex');
const ok=(v,m)=>{if(!v)throw Error('R195 CI producer: '+m);};
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 e.RUNNER_TEMP&&e.GITHUB_OUTPUT&&!e.PGHOST&&!e.PGPASSWORD&&
 !e.AWS_ACCESS_KEY_ID&&!e.AWS_SECRET_ACCESS_KEY&&
 !e.AWS_SESSION_TOKEN&&!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'exact unprivileged CI source without AWS, DB or OIDC secrets required');
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
ok(source===e.GITHUB_SHA,'git HEAD SHA moved');
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
const f=await buildR194Fixture({commit:source,bundleSha256});
const signed=createR195SignedPackage({
 commit:source,bundleSha256,
 beforeIntake:f.before.intake,afterIntake:f.after.intake,
 beforeAssessment:f.before.assessment,afterAssessment:f.after.assessment,
 ledger:f.board,evidenceDelta:f.evidenceDelta,riskTrend:f.riskTrend,
 privateKey:f.keyPair.privateKey,publicKeyDer:f.publicKeyDer,
 clock:()=>f.now
});
ok(signed.signature.length===64&&signed.rendered.handoffs.byOwner.length===6&&
 signed.rendered.handoffs.totalControls===8,'all six owner packet groups mandatory');
const dir=join(e.RUNNER_TEMP,'r195-public');
await mkdir(dir,{recursive:true,mode:0o700});
await mkdir(join(dir,'handoffs'),{mode:0o700});
const files=[
 ['index.html',signed.rendered.html],
 ['report.md',signed.rendered.markdown],
 ['signed-packet.json',signed.bytes],
 ['signature.base64url',signed.signature.toString('base64url')+'\n'],
 ['public.der.base64',f.publicKeyDer.toString('base64')+'\n'],
 ['handoffs/manifest.json',JSON.stringify({
  ...signed.rendered.handoffs.manifest,
  manifestSha256:signed.rendered.handoffManifestSha256},null,2)+'\n']
];
for(const x of signed.rendered.handoffs.byOwner){
 files.push(['handoffs/'+x.owner+'.md',x.markdown]);
 files.push(['handoffs/'+x.owner+'.csv','\ufeff'+x.csv]);
}
for(const [name,content] of files){
 await writeFile(join(dir,name),content,{mode:0o600,flag:'wx'});
}
await appendFile(e.GITHUB_OUTPUT,[
 'packet_sha='+signed.fileSha256,
 'key_sha='+signed.publicKeySha256,
 'html_sha='+signed.rendered.htmlSha256,
 'markdown_sha='+signed.rendered.markdownSha256,
 'handoff_sha='+signed.rendered.handoffManifestSha256,
 'tree_sha='+bundleSha256
].join('\n')+'\n');
console.log('R195_REAL_EPHEMERAL_ED25519_MOBILE_HTML_AND_SIX_ROLE_HANDOFFS=PASS');
console.log('R195_LIVE_HUMAN_IAM_TLS_LEGAL_PRIVACY_APPROVAL=NO_GO');
