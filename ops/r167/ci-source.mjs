/**
 * R167 GitHub Actions source runner: pg_dump -> AES-GCM -> X25519 wrapped DEK.
 * Only synthetic PG17 fixture. The test recipient key is PUBLICLY DERIVABLE,
 * therefore this CI exercise does not demonstrate actual KMS confidentiality.
 */
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,generateKeyPairSync,createHash} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {r167SyntheticCiRecipient,wrapR167DataKey} from './key-envelope.mjs';
import {readR167FixtureInventory} from './pg-witness.mjs';
import {createR167TransferManifest} from './transfer-manifest.mjs';

const env=process.env;
const assert=(v,msg)=>{if(!v)throw Error('R167 CI source: '+msg);};
assert(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 /^[a-f0-9]{12,64}$/.test(env.R167_PG_CONTAINER||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 typeof env.GITHUB_OUTPUT==='string',
 'isolated, disposable GitHub runner required');
function spawn(binary,args,{input}={}){
 const p=spawnSync(binary,args,{input,maxBuffer:40*1024*1024,
  encoding:null,timeout:60000});
 assert(p.status===0&&!p.error,'synthetic source command failed');
 return p.stdout;
}
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const sourceInventory=await readR167FixtureInventory({
 sqlRead:async sql=>spawn('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql]).toString('utf8').trim()
});
const dump=spawn('docker',['exec','-u','postgres',env.R167_PG_CONTAINER,
 'pg_dump','-U','postgres','-d','postgres','--format=custom']);
assert(dump.length>512&&dump.length<25*1024*1024&&
 dump.subarray(0,5).toString('utf8')==='PGDMP',
 'real PostgreSQL17 custom dump required');
let dataKey;
try{
 dataKey=randomBytes(32);
 const encrypted=sealR165Backup({
  plaintext:dump,key:dataKey,commit,bundleSha256:bundle.sha256
 });
 const receiver=r167SyntheticCiRecipient({sourceCommit:commit});
 const envelope=wrapR167DataKey({
  dataKey,recipientPublicKey:receiver.publicKey,
  pinnedRecipientSpkiSha256:receiver.pinnedSpkiSha256,
  sourceCommit:commit,bundleSha256:bundle.sha256,
  ciphertextSha256:encrypted.encryptedSha256,keyEpoch:receiver.keyEpoch
 });
 const signer=generateKeyPairSync('ed25519');
 const receipt=createR167TransferManifest({
  sourceCommit:commit,bundleSha256:bundle.sha256,
  ciphertextSha256:encrypted.encryptedSha256,
  ciphertextBytes:encrypted.blob.length,
  envelope,recipientSpkiSha256:receiver.pinnedSpkiSha256,
  sourceInventory,privateKey:signer.privateKey
 });
 const out=join(env.RUNNER_TEMP,'r167-cross-runner-transfer');
 await mkdir(out,{mode:0o700});
 await writeFile(join(out,'ciphertext.r165enc'),encrypted.blob,{flag:'wx',mode:0o600});
 await writeFile(join(out,'key-envelope.json'),JSON.stringify(envelope)+'\n',
  {flag:'wx',mode:0o600});
 await writeFile(join(out,'transfer-manifest.json'),JSON.stringify(receipt)+'\n',
  {flag:'wx',mode:0o600});
 const sha=hash=>createHash('sha256').update(hash).digest('hex');
 const manifestHash=sha(Buffer.from(JSON.stringify(receipt)));
 await appendFile(env.GITHUB_OUTPUT,[
  'bundle_sha='+bundle.sha256,
  'archive_sha='+encrypted.encryptedSha256,
  'signer_pin='+receipt.signerSpkiSha256,
  'recipient_pin='+receiver.pinnedSpkiSha256,
  'manifest_sha='+manifestHash
 ].join('\n')+'\n',{encoding:'utf8'});
 console.log('R167_REAL_PG17_SOURCE_CUSTOM_DUMP_ENCRYPTED=PASS');
 console.log('R167_X25519_RECIPIENT_BOUND_DEK_AND_SIGNED_MANIFEST=PASS');
 console.log('R167_ONLY_SYNTHETIC_CI_RECIPIENT_KEY=NO_KMS');
}finally{
 if(dataKey)dataKey.fill(0);
 dump.fill(0);
}
