/**
 * R166 disposable CI stage 2, launched in a FRESH Node.js process.
 * Uses new TLS PostgreSQL connections to verify signed evidence and persisted
 * fences. Erases temporary symmetric key and local encrypted evidence after.
 */
import {readFile,lstat,rm,writeFile,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {O_RDONLY,O_NOFOLLOW} from 'node:constants';
import {randomUUID} from 'node:crypto';
import {createR160PgTransport} from '../r160/pg-driver.mjs';
import {createR165DurableQuorum} from '../r165/durable-quorum.mjs';
import {createR165QuarantineControl,createR165QuarantinedStore} from '../r165/quarantine-gate.mjs';
import {createR166AuditChain} from './audit-chain.mjs';
import {createR166EvidenceVault} from './evidence-vault.mjs';
import {createR166RestartVerifier} from './restart-verifier.mjs';
const env=process.env,REPO='osmanosmanov6880-bot/marcosa-fusion';
const ok=(v,m)=>{if(!v)throw Error('R166 restart CI: '+m);};
ok(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPO&&
 env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string','fresh CI process with local fixture only');
const proofFile=join(env.RUNNER_TEMP,'r166-public-restart-proof.json');
const keyFile=join(env.RUNNER_TEMP,'r166-temp-aes-key.bin');
let pool,key,proof;
try{
 const info=await lstat(keyFile);
 ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&
  (info.mode&0o077)===0&&info.size===32,'private AES key file permissions required');
 const fd=await open(keyFile,O_RDONLY|O_NOFOLLOW);
 try{key=await fd.readFile();}finally{await fd.close();}
 ok(Buffer.isBuffer(key)&&key.length===32,'ephemeral AES key missing');
 proof=JSON.parse(await readFile(proofFile,'utf8'));
 ok(proof&&proof.schemaVersion===1&&proof.commit===env.GITHUB_SHA&&
  proof.productionAuthorized===false&&proof.offsiteVerified===false&&
  typeof proof.replicaRoot==='string'&&
  resolve(proof.replicaRoot)===proof.replicaRoot&&
  proof.replicaRoot.startsWith(join(env.RUNNER_TEMP,'r166-vault-copy-'))&&
  JSON.stringify(proof.source)===JSON.stringify(proof.restored),
  'same-commit independent restored database proof missing');
 const caPem=await readFile(env.R166_CA_FILE,'utf8');
 pool=createR160PgTransport({ciLoopback:true,config:{
  host:'127.0.0.1',expectedHost:'127.0.0.1',port:5432,database:'postgres',
  user:'marcosa_r160_ci',password:env.R166_APP_PASSWORD,
  caPem,maxConnections:4
 }});
 await pool.preflight();
 const audit=createR166AuditChain({pool,commit:proof.commit});
 const gate=createR165QuarantineControl({pool});
 const nonce=createR165DurableQuorum({pool});
 const store=createR165QuarantinedStore({pool});
 const vault=createR166EvidenceVault({root:proof.replicaRoot});
 const verifier=createR166RestartVerifier({audit,quarantine:gate,
  quorum:nonce,store,vault});
 const result=await verifier.verify({
  signedAnchor:proof.signedAnchor,anchorPublicKeyPem:proof.anchorPublicKeyPem,
  pinnedSpkiSha256:proof.pinnedSpkiSha256,signedQuorum:proof.signedQuorum,
  key,commit:proof.commit,bundleSha256:proof.bundleSha256,
  encryptedSha256:proof.encryptedSha256,
  auditHead:proof.auditHead,auditSeq:proof.auditSeq,
  quarantineGeneration:proof.quarantineGeneration,
  mutation:{
   actorId:'15900000-0000-4159-8159-000000000001',
   sessionId:'16100000-0000-4161-8161-000000000501',
   authExpiresAt:Math.floor(Date.now()/1000)+300,
   name:'edit',key:randomUUID(),
   data:{seriesId:'15900000-0000-4159-8159-000000000301',
    revision:3,title:'R166 forbidden restart write',description:'Must rollback'}
  }
 });
 ok(result.verified&&result.postRestartNonceReplayRejected===true&&
  result.quarantinePersistedClosed===true&&
  result.auditHeadAnchored===true&&result.localEncryptedReadback===true&&
  result.productionAuthorized===false,'post-restart durable control proof denied');
 const report={schemaVersion:1,commit:proof.commit,
  bundleSha256:proof.bundleSha256,encryptedSha256:proof.encryptedSha256,
  auditHead:proof.auditHead,auditEvents:proof.auditSeq,
  signedAnchorPinned:true,
  freshNodeProcessVerified:true,postRestartReplayRejected:true,
  quarantineClosed:true,encryptedCopyReadback:true,
  restoredPg17Matches:true,independentHostVerified:false,
  externalStorageVerified:false,liveSupabaseVerified:false,
  productionAuthorized:false};
 await writeFile(join(env.RUNNER_TEMP,'r166-safe-evidence-report.json'),
  JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('R166_NEW_PROCESS_PG17_NONCE_REPLAY_REFUSED=PASS');
 console.log('R166_NEW_PROCESS_DURABLE_SQL_QUARANTINE_CLOSED=PASS');
 console.log('R166_SIGNED_EXTERNAL_KEY_PIN_AND_SHA_CHAIN=PASS');
 console.log('R166_LOCAL_ENCRYPTED_COPY_SOURCE_BOUND_READBACK=PASS');
 console.log('R166_NO_REAL_OFFSITE_KMS_SUPABASE_OR_PRODUCTION=PASS');
}finally{
 if(key)key.fill(0);
 if(pool)try{await pool.end();}catch{}
 await rm(keyFile,{force:true});
 await rm(proofFile,{force:true});
 if(proof?.replicaRoot&&
  proof.replicaRoot.startsWith(join(env.RUNNER_TEMP,'r166-vault-copy-')))
  await rm(proof.replicaRoot,{recursive:true,force:true});
}
