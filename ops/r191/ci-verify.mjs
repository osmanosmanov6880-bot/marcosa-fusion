/** Separate runner independently checks public Ed25519 signatures, DER and
 * exact bundle. No secret, GitHub token, AWS credential or DB connection. */
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyR191PortableEvidence} from './portable-evidence.mjs';
import {verifyR191PinnedReviewers} from './trusted-reviewers.mjs';
const e=process.env;
const fail=m=>{throw Error('R191 second runner: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
ok(e.GITHUB_ACTIONS==='true'&&
 e.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(e.GITHUB_SHA||'')&&
 /^[a-f0-9]{64}$/.test(e.R191_FILE_SHA||'')&&
 /^[a-f0-9]{64}$/.test(e.R191_REGISTRY_SHA||'')&&
 !e.PGHOST&&!e.PGPASSWORD&&!e.AWS_ACCESS_KEY_ID&&
 !e.AWS_SECRET_ACCESS_KEY&&!e.AWS_SESSION_TOKEN&&
 !e.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
 'independent runner must have no external provider or database credentials');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
ok(commit===e.GITHUB_SHA,'independent checkout SHA not identical');
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
const bundleSha256=sha(tree);
const dir=join(e.RUNNER_TEMP,'r191-independent');
const bytes=await readFile(join(dir,'r191-evidence.json'));
const proof=verifyR191PortableEvidence({bytes,
 expectedFileSha256:e.R191_FILE_SHA,commit,bundleSha256,
 expectedRegistrySha256:e.R191_REGISTRY_SHA,allowHistoricalCi:true});
const json=JSON.parse(bytes.toString('utf8'));
const extraBytes=await readFile(join(dir,'r191-public-crypto.json'));
ok(extraBytes.length<40000,'public proof metadata too large');
const extra=JSON.parse(extraBytes.toString('utf8'));
ok(extra.schemaVersion===1&&extra.productionAuthorized===false&&
 extra.realHumanIdentitiesVerified===false&&
 extra.actualProviderTlsVerified===false,
 'public CI proof claims false production or provider identity');
const registry=Buffer.from(extra.registryBase64,'base64');
ok(registry.toString('base64')===extra.registryBase64&&
 sha(registry)===e.R191_REGISTRY_SHA,'public reviewer registry changed');
const identities=verifyR191PinnedReviewers({
 registryBytes:registry,expectedRegistrySha256:e.R191_REGISTRY_SHA,
 github:json.proofs[0],packet:extra.packet,
 signatures:extra.signatures,bundleSha256,commit,
 clock:()=>json.proofs[1].observedAtMs});
ok(identities.evidenceSha256===json.proofs[1].evidenceSha256,
 'second-runner cryptographic key/identity receipt differs');
const der=Buffer.from(extra.certificateDerBase64,'base64');
const cert=new X509Certificate(der);
ok(der.toString('base64')===extra.certificateDerBase64&&
 sha(der)===json.proofs[2].leafFingerprintSha256&&
 cert.checkHost(json.proofs[2].hostname)===json.proofs[2].hostname,
 'public DER leaf pin or staging SAN failed');
ok(proof.verified===true&&proof.productionAuthorized===false,
 'untrusted portable evidence');
console.log('R191_SECOND_RUNNER_CRYPTO_ED25519_DER_HOST_AND_SHA256=PASS');
console.log('R191_REAL_STAGING_HUMAN_IAM_TLS_LEGAL_APPROVAL=NO_GO');
