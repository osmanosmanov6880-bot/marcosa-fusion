/** First CI runner: synthetic proofs, real Ed25519, mock TLS cert and IAM.
 * No secrets, actual service credentials, deployments or real customer data. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR191Fixture} from './ci-fixture.mjs';
const e=process.env;
const fail=m=>{throw Error('R191 CI producer: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 e.RUNNER_TEMP&&e.GITHUB_OUTPUT&&
 !e.AWS_ACCESS_KEY_ID&&!e.AWS_SECRET_ACCESS_KEY&&
 !e.AWS_SESSION_TOKEN&&!e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'isolated CI job and source required');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
ok(commit===e.GITHUB_SHA,'checkout differs from expected job SHA');
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=createHash('sha256').update(tree).digest('hex');
const proof=await buildR191Fixture({commit,bundleSha256});
const dir=join(e.RUNNER_TEMP,'r191-first');
await mkdir(dir,{mode:0o700,recursive:true});
await writeFile(join(dir,'r191-evidence.json'),proof.portable.bytes,
 {flag:'wx',mode:0o600});
const publicCrypto={
 schemaVersion:1,registryBase64:proof.registryBytes.toString('base64'),
 certificateDerBase64:proof.certDer.toString('base64'),
 packet:proof.packet,signatures:proof.signatures,
 realHumanIdentitiesVerified:false,
 actualProviderTlsVerified:false,
 productionAuthorized:false
};
await writeFile(join(dir,'r191-public-crypto.json'),
 JSON.stringify(publicCrypto)+'\n',{flag:'wx',mode:0o600});
await appendFile(e.GITHUB_OUTPUT,'r191_file_sha='+proof.portable.sha256+'\n'+
 'r191_registry_sha='+proof.registrySha256+'\n');
console.log('R191_FIRST_RUNNER_ED25519_TLS_CERT_AWS_MOCK_NO_GO=PASS');
console.log('R191_FILES_PRIVATE_KEYS_AND_AWS_SECRETS=NOT_PERSISTED');
