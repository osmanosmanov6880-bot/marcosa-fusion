/**
 * R167 GitHub Actions second (independent) runner:
 * artifact download -> signed receipt -> X25519 unwrap -> authenticated
 * AES-GCM -> REAL pg_restore into a brand-new PostgreSQL 17 service.
 *
 * The deterministic CI-only recipient private key is derived on target from
 * PUBLIC information; this proves compatibility, NOT actual confidentiality.
 */
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {openR165Backup} from '../r165/encrypted-backup.mjs';
import {r167SyntheticCiRecipient,unwrapR167DataKey} from './key-envelope.mjs';
import {verifyR167TransferManifest,verifyR167RestoredInventory} from './transfer-manifest.mjs';
import {readR167FixtureInventory} from './pg-witness.mjs';

const env=process.env;
const check=(v,msg)=>{if(!v)throw Error('R167 isolated receiver: '+msg);};
check(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 /^[a-f0-9]{12,64}$/.test(env.R167_PG_CONTAINER||'')&&
 /^[a-f0-9]{64}$/.test(env.R167_BUNDLE_SHA||'')&&
 /^[a-f0-9]{64}$/.test(env.R167_ARCHIVE_SHA||'')&&
 /^[a-f0-9]{64}$/.test(env.R167_SIGNER_PIN||'')&&
 /^[a-f0-9]{64}$/.test(env.R167_RECIPIENT_PIN||'')&&
 /^[a-f0-9]{64}$/.test(env.R167_MANIFEST_SHA||'')&&
 typeof env.RUNNER_TEMP==='string',
 'second independent disposable GitHub runner only');
function spawn(binary,args,{input}={}){
 const p=spawnSync(binary,args,{
  input,maxBuffer:40*1024*1024,encoding:null,timeout:60000});
 check(p.status===0&&!p.error,'PG17 target command failed');
 return p.stdout;
}
const commit=env.GITHUB_SHA;
const regenerated=await buildR163Bundle({root:process.cwd(),commit});
check(regenerated.sha256===env.R167_BUNDLE_SHA,
 'second independent runner checked out different exact source bytes');
const dir=join(env.RUNNER_TEMP,'r167-downloaded-transfer');
let dataKey,dump;
try{
 const blob=await readFile(join(dir,'ciphertext.r165enc'));
 const envelope=JSON.parse(await readFile(join(dir,'key-envelope.json'),'utf8'));
 const receipt=JSON.parse(await readFile(join(dir,'transfer-manifest.json'),'utf8'));
 const computedManifestHash=createHash('sha256')
  .update(JSON.stringify(receipt)).digest('hex');
 check(computedManifestHash===env.R167_MANIFEST_SHA,
  'downloaded manifest differs from first CI job digest');
 const ciphertextSha256=createHash('sha256').update(blob).digest('hex');
 check(ciphertextSha256===env.R167_ARCHIVE_SHA,
  'second CI runner received a different encrypted archive');
 const signed=verifyR167TransferManifest({
  receipt,envelope,expectedCommit:commit,
  expectedBundleSha256:env.R167_BUNDLE_SHA,
  expectedCiphertextSha256:env.R167_ARCHIVE_SHA,
  expectedSignerSpkiSha256:env.R167_SIGNER_PIN,
  expectedRecipientSpkiSha256:env.R167_RECIPIENT_PIN
 });
 check(signed.verified&&signed.manifest.ciphertextBytes===blob.length,
  'independent offline Ed25519 archive receipt did not verify');
 const receiver=r167SyntheticCiRecipient({sourceCommit:commit});
 check(receiver.pinnedSpkiSha256===env.R167_RECIPIENT_PIN&&
  receiver.externalKmsVerified===false,
  'synthetic key identity mismatch');
 dataKey=unwrapR167DataKey({
  envelope,recipientPrivateKey:receiver.privateKey,
  pinnedRecipientSpkiSha256:receiver.pinnedSpkiSha256,
  sourceCommit:commit,bundleSha256:env.R167_BUNDLE_SHA,
  ciphertextSha256:env.R167_ARCHIVE_SHA,minimumKeyEpoch:1
 });
 const recovered=openR165Backup({
  blob,key:dataKey,commit,bundleSha256:env.R167_BUNDLE_SHA
 });
 dump=recovered.plaintext;
 check(dump.subarray(0,5).toString('utf8')==='PGDMP',
  'new runner failed to reconstruct native PostgreSQL 17 archive');
 let wrongKeyDenied=false,tamperingDenied=false,wrongEpochDenied=false;
 try{openR165Backup({blob,key:randomBytes(32),commit,bundleSha256:env.R167_BUNDLE_SHA});}
 catch{wrongKeyDenied=true;}
 const changed=Buffer.from(blob);changed[changed.length-20]^=1;
 try{openR165Backup({blob:changed,key:dataKey,commit,bundleSha256:env.R167_BUNDLE_SHA});}
 catch{tamperingDenied=true;}
 try{unwrapR167DataKey({
  envelope,recipientPrivateKey:receiver.privateKey,
  pinnedRecipientSpkiSha256:receiver.pinnedSpkiSha256,
  sourceCommit:commit,bundleSha256:env.R167_BUNDLE_SHA,
  ciphertextSha256:env.R167_ARCHIVE_SHA,minimumKeyEpoch:2
 });}catch{wrongEpochDenied=true;}
 check(wrongKeyDenied&&tamperingDenied&&wrongEpochDenied,
  'off-runner crypto anti-tamper/rotation tests failed');
 // The fresh PG17 service contains only precreated NOLOGIN roles; the
 // entire schema and data below come from the authenticated source dump.
 spawn('docker',['exec','-u','postgres','-i',env.R167_PG_CONTAINER,
  'pg_restore','-U','postgres','-d','postgres','--no-owner','--exit-on-error'],
  {input:dump});
 const restored=await readR167FixtureInventory({
  sqlRead:async sql=>spawn('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql])
   .toString('utf8').trim()
 });
 const equivalence=verifyR167RestoredInventory({
  source:signed.manifest.sourceInventory,restored
 });
 check(equivalence.verified&&equivalence.rlsPreserved===true&&
  equivalence.sessionRevocationPreserved===true&&
  equivalence.realSupabaseVerified===false,'independent PG17 role parity failed');
 const invalid=spawnSync('docker',['exec','-u','postgres','-i',env.R167_PG_CONTAINER,
  'pg_restore','--list'],{input:Buffer.from('NOT-A-PGDMP'),
  encoding:null,timeout:8000});
 check(invalid.status!==0,'corrupt PG17 archive unexpectedly accepted');
 const report={
  schemaVersion:1,sourceCommit:commit,
  sourceBundleSha256:env.R167_BUNDLE_SHA,
  encryptedArchiveSha256:ciphertextSha256,
  distinctGitHubRunnerJob:true,realPostgres17Restore:true,
  signedSourceReceiptVerified:true,recipientKeyWrapped:true,
  recipientPrivateKeyIsPubliclyDerivableCiFixture:true,
  keyRotationDenied:true,wrongKeyDenied,tamperingDenied,
  rlsPreserved:true,sessionRevocationPreserved:true,
  closedQuarantineRestored:true,sourceRowDigestMatched:true,
  trueKmsUsed:false,offsiteConfidentialityCertified:false,
  productionAuthorized:false,liveSupabaseConnected:false
 };
 await writeFile(join(env.RUNNER_TEMP,'r167-target-safe-report.json'),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R167_SECOND_INDEPENDENT_RUNNER_PG17_RESTORED=PASS');
 console.log('R167_REMOTE_ARTIFACT_SOURCE_PIN_AND_SIGNATURE=PASS');
 console.log('R167_X25519_WRAPPED_AESGCM_TAMPER_AND_EPOCH_FAIL_CLOSED=PASS');
 console.log('R167_PG17_RLS_SESSION_QUARANTINE_ROWS_IDENTICAL=PASS');
 console.log('R167_PUBLIC_FIXTURE_RECIPIENT_NO_REAL_KMS_OR_PRODUCTION=PASS');
}finally{
 if(dataKey)dataKey.fill(0);
 if(dump)dump.fill(0);
 await rm(dir,{recursive:true,force:true});
}
