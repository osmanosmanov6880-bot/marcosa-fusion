/**
 * R166 disposable CI stage 1: real PG17 durable audit, two separate private
 * ciphertext directories, Ed25519 anchor, independently restored PG17 copy.
 * Writes only a temporary local AES key, public review proof and safe metrics.
 */
import {readFile,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createR160PgTransport} from '../r160/pg-driver.mjs';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
import {createR165DurableQuorum} from '../r165/durable-quorum.mjs';
import {createR165QuarantineControl} from '../r165/quarantine-gate.mjs';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR166AuditChain,verifyR166Snapshot} from './audit-chain.mjs';
import {createR166EvidenceVault} from './evidence-vault.mjs';
import {createR166SignedAnchor,r166AnchorFingerprint} from './signed-anchor.mjs';
const env=process.env,REPO='osmanosmanov6880-bot/marcosa-fusion';
const check=(v,msg)=>{if(!v)throw Error('R166 CI stage1: '+msg);};
check(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPO&&
 env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
 env.R166_ADMIN_PASSWORD==='r160-disposable-admin-only'&&
 /^[a-f0-9]{12,64}$/.test(env.R166_SERVICE_CONTAINER||'')&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string','disposable CI fixture only');
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const adminEnv={...env,PGHOST:'127.0.0.1',PGPORT:'5432',
 PGUSER:'postgres',PGDATABASE:'postgres',PGPASSWORD:env.R166_ADMIN_PASSWORD};
function run(binary,args,{input,timeout=45000}={}){
 const r=spawnSync(binary,args,{input,timeout,maxBuffer:40*1024*1024,env:adminEnv});
 check(r.status===0&&!r.error,'disposable command failed: '+binary);
 return r.stdout;
}
function query(database,sql){
 return run('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-d',database,'-c',sql])
  .toString('utf8').trim();
}
const inv=[
 "SELECT json_build_object(",
 "'nonceCount',(SELECT count(*) FROM marcosa_private.r165_drill_nonces),",
 "'closed',(SELECT closed FROM marcosa_private.r165_quarantine WHERE id=1),",
 "'generation',(SELECT generation FROM marcosa_private.r165_quarantine WHERE id=1),",
 "'auditHead',(SELECT head_sha256 FROM marcosa_private.r166_audit_head WHERE id=1),",
 "'auditSeq',(SELECT seq FROM marcosa_private.r166_audit_head WHERE id=1),",
 "'auditEvents',(SELECT count(*) FROM marcosa_private.r166_audit_events),",
 "'revokedSessions',(SELECT count(*) FROM auth.sessions WHERE id='16100000-0000-4161-8161-000000000502'::uuid),",
 "'creatorRevision',(SELECT revision FROM public.marcosa_seasons WHERE id='15900000-0000-4159-8159-000000000301'::uuid),",
 "'auditRls',(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.r166_audit_events'::regclass),",
 "'browserCanRead',has_table_privilege('authenticated','marcosa_private.r166_audit_events','SELECT'),",
 "'writerCanDelete',has_table_privilege('marcosa_r166_audit_writer','marcosa_private.r166_audit_events','DELETE')",
 ")::text;"
].join(' ');
const caPem=await readFile(env.R166_CA_FILE,'utf8');
const pgConfig={host:'127.0.0.1',expectedHost:'127.0.0.1',
 port:5432,database:'postgres',user:'marcosa_r160_ci',
 password:env.R166_APP_PASSWORD,caPem,maxConnections:4};
const pool=createR160PgTransport({config:pgConfig,ciLoopback:true});
try{
 await pool.preflight();
 const gate=await createR165QuarantineControl({pool}).status();
 check(gate.closed===true&&gate.generation>=3,
  'quarantine must be closed before new CI recovery evidence');
 const targetDigest=createHash('sha256').update('r166-restart:'+commit+':'+bundle.sha256).digest('hex');
 const keys=['operator','independent-reviewer'].map(role=>{
  const k=generateKeyPairSync('ed25519');
  return{role,privateKey:k.privateKey,
   publicKeyPem:k.publicKey.export({format:'pem',type:'spki'})};
 });
 const packet=createR164DrillChallenge({commit,targetDigest,synthetic:true});
 const approvals=keys.map(k=>({role:k.role,publicKeyPem:k.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),k.privateKey)
   .toString('base64url')}));
 const pinnedReviewerFingerprints=Object.fromEntries(keys.map(k=>[
  k.role,r164ReviewerFingerprint(k.publicKeyPem)]));
 const signedQuorum={packet,approvals,pinnedReviewerFingerprints,commit,targetDigest};
 check((await createR165DurableQuorum({pool}).consume(signedQuorum)).rehearsalLeaseRecorded,
  'new signed nonce not durably accepted');
 const chain=createR166AuditChain({pool,commit});
 await chain.append({category:'nonce_consumed',outcome:'ok'});
 await chain.append({category:'quarantine_closed',outcome:'blocked'});
 await chain.append({category:'archive_encrypted',outcome:'ok'});
 const snapshot=await chain.snapshot();
 check(verifyR166Snapshot(snapshot,{commit,expectedHead:snapshot.head}).matched&&
  snapshot.seq===3,'PostgreSQL event hash chain not verified');
 const original=run('docker',['exec','-u','postgres',env.R166_SERVICE_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','--format=custom'],{timeout:45000});
 check(Buffer.isBuffer(original)&&original.length>512&&original.length<25*1024*1024,
  'native PostgreSQL backup missing');
 const aesKey=randomBytes(32);
 const archive=sealR165Backup({plaintext:original,key:aesKey,
  commit,bundleSha256:bundle.sha256});
 const firstRoot=await mkdtemp(join(env.RUNNER_TEMP,'r166-vault-primary-'));
 const secondRoot=await mkdtemp(join(env.RUNNER_TEMP,'r166-vault-copy-'));
 await chmod(firstRoot,0o700);await chmod(secondRoot,0o700);
 const primary=createR166EvidenceVault({root:firstRoot});
 const secondary=createR166EvidenceVault({root:secondRoot});
 const stored=await primary.putEncrypted({blob:archive.blob});
 check(stored.sha256===archive.encryptedSha256,'on-disk AES ciphertext changed');
 const replica=await primary.replicateTo({sha256:stored.sha256,targetVault:secondary});
 check(replica.copiedAndReadBack&&replica.externalStorageVerified===false,
  'second private local directory readback failed');
 const signer=generateKeyPairSync('ed25519');
 const anchorPublicKeyPem=signer.publicKey.export({format:'pem',type:'spki'});
 const signedAnchor=createR166SignedAnchor({privateKey:signer.privateKey,
  commit,bundleSha256:bundle.sha256,encryptedSha256:stored.sha256,
  auditHead:snapshot.head,auditSeq:snapshot.seq,quarantineGeneration:gate.generation});
 const pinnedSpkiSha256=r166AnchorFingerprint(anchorPublicKeyPem);
 const source=JSON.parse(query('postgres',inv));
 check(source.nonceCount===2&&source.closed===true&&source.auditSeq===3&&
  source.auditEvents===3&&source.auditHead===snapshot.head&&
  source.revokedSessions===0&&source.creatorRevision===3&&source.auditRls===true&&
  source.browserCanRead===false&&source.writerCanDelete===false,
  'source privacy, replay or audit invariants failed');
 query('postgres','CREATE DATABASE marcosa_r166_restored TEMPLATE template0;');
 run('docker',['exec','-u','postgres','-i',env.R166_SERVICE_CONTAINER,
  'pg_restore','-U','postgres','-d','marcosa_r166_restored',
  '--no-owner','--exit-on-error'],{input:original,timeout:45000});
 const restored=JSON.parse(query('marcosa_r166_restored',inv));
 check(JSON.stringify(source)===JSON.stringify(restored),
  'independent restored PG17 permissions, audit head, gate or nonce differ');
 const keyFile=join(env.RUNNER_TEMP,'r166-temp-aes-key.bin'),
 proofFile=join(env.RUNNER_TEMP,'r166-public-restart-proof.json');
 await writeFile(keyFile,aesKey,{flag:'wx',mode:0o600});
 await writeFile(proofFile,JSON.stringify({
  schemaVersion:1,commit,bundleSha256:bundle.sha256,
  encryptedSha256:stored.sha256,auditHead:snapshot.head,auditSeq:snapshot.seq,
  quarantineGeneration:gate.generation,
  anchorPublicKeyPem,pinnedSpkiSha256,signedAnchor,signedQuorum,
  replicaRoot:secondRoot,source,restored,
  productionAuthorized:false,offsiteVerified:false
 })+'\n',{flag:'wx',mode:0o600});
 aesKey.fill(0);
 original.fill(0);
 console.log('R166_PG17_DURABLE_CHAIN_AND_RLS=PASS');
 console.log('R166_LOCAL_AES_GCM_COPY_AND_RESTORED_DB_INVENTORY=PASS');
 console.log('R166_TEMPORARY_OFFLINE_RESTART_PROOF_WRITTEN=PASS');
 console.log('R166_EXTERNAL_STORAGE_AND_PRODUCTION=NO_GO');
}finally{await pool.end();}
