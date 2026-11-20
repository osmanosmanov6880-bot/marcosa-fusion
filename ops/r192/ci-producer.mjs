/** R192 first CI runner: independent public-only package, ephemeral keys. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR192Fixture} from './ci-fixture.mjs';
const e=process.env;
const fail=m=>{throw Error('R192 producer: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&e.RUNNER_TEMP&&e.GITHUB_OUTPUT&&
 !e.AWS_ACCESS_KEY_ID&&!e.AWS_SECRET_ACCESS_KEY&&
 !e.AWS_SESSION_TOKEN&&!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'source-pinned non-privileged CI mandatory');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
ok(commit===e.GITHUB_SHA,'git HEAD does not match exact CI SHA');
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
const x=buildR192Fixture({commit,bundleSha256});
ok(x.bytes.length>=3000&&x.bytes.length<=45000,'bounded public artifact required');
const target=join(e.RUNNER_TEMP,'r192-public');
await mkdir(target,{recursive:true,mode:0o700});
await writeFile(join(target,'r192-public.json'),x.bytes,{flag:'wx',mode:0o600});
const lines=[
 'package_sha='+x.fileSha256,
 'old_registry_sha='+x.oldRegistrySha256,
 'release_sha='+x.release.evidenceSha256,
 'review_sha='+x.review.evidenceSha256,
 'iam_sha='+x.iamRisk.evidenceSha256,
 'rotation_sha='+x.rotation.evidenceSha256
];
await appendFile(e.GITHUB_OUTPUT,lines.join('\n')+'\n');
console.log('R192_PUBLIC_EPHEMERAL_THREE_ED25519_AND_NO_GO=PASS');
console.log('R192_PRODUCTION_AND_REAL_HUMAN_IDENTITY_NOT_ATTESTED');
