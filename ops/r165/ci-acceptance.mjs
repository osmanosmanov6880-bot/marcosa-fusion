/**
 * R165 disposable PostgreSQL 17: durable nonce, quarantine, AES-GCM archive.
 * This is NOT a live Supabase database, offsite backup or production deploy.
 */
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createR160PgTransport} from '../r160/pg-driver.mjs';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
import {createR165DurableQuorum} from './durable-quorum.mjs';
import {createR165QuarantinedStore,createR165QuarantineControl} from './quarantine-gate.mjs';
import {sealR165Backup,openR165Backup} from './encrypted-backup.mjs';
import {verifyR165EncryptedRestore} from './recovery-verifier.mjs';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';

const repository='osmanosmanov6880-bot/marcosa-fusion';
const ok=(v,m)=>{if(!v)throw Error('R165 isolated acceptance: '+m);};
const env=process.env;
ok(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===repository&&
 env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='postgres'&&
 env.R165_ADMIN_PASSWORD==='r160-disposable-admin-only'&&
 /^[a-f0-9]{12,64}$/.test(env.R165_SERVICE_CONTAINER||'')&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string','authorized disposable PG17 runner required');
const adminEnv={PATH:env.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',
 PGUSER:'postgres',PGDATABASE:'postgres',PGPASSWORD:env.R165_ADMIN_PASSWORD};
function processRun(name,args,{input,timeout=45000}={}){
 const x=spawnSync(name,args,{input,timeout,env:{...env,...adminEnv},maxBuffer:40*1024*1024});
 ok(x.status===0&&!x.error,'isolated process rejected: '+name);
 return x.stdout;
}
function query(db,statement){
 return processRun('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-d',db,'-c',statement])
  .toString('utf8').trim();
}
const actor='15900000-0000-4159-8159-000000000001';
const session='16100000-0000-4161-8161-000000000501';
const season='15900000-0000-4159-8159-000000000301';
const commit=env.GITHUB_SHA;
const bundle=await buildR163Bundle({root:process.cwd(),commit});
const caPem=await readFile(env.R165_CA_FILE,'utf8');
const pool=createR160PgTransport({ciLoopback:true,config:{
 host:'127.0.0.1',expectedHost:'127.0.0.1',port:5432,database:'postgres',
 user:'marcosa_r160_ci',password:env.R165_APP_PASSWORD,caPem,maxConnections:4
}});
const checkpointAtMs=Date.now();
let encryptedFile;
try{
 const probe=await pool.preflight();
 ok(probe.ok,'R165 writer role preflight failed');
 const payload={actorId:actor,sessionId:session,
  authExpiresAt:Math.floor(Date.now()/1000)+180,
  name:'edit',key:'16500000-0000-4165-8165-000000000601',
  data:{seriesId:season,revision:2,title:'R165 Durable Session Fence',
   description:'Disposable PostgreSQL quarantine acceptance'}};
 const store=createR165QuarantinedStore({pool});
 let firstDenied=false;
 try{await store.execute(payload);}catch(e){firstDenied=e.status===503;}
 ok(firstDenied,'closed-by-default quarantine permitted editor');
 ok(query('postgres',"SELECT closed::text||':'||generation FROM marcosa_private.r165_quarantine WHERE id=1;")==='true:1',
  'initial durable quarantine default changed');
 // No application role can re-open; ONLY synthetic fixture administrator.
 query('postgres',"UPDATE marcosa_private.r165_quarantine "+
  "SET closed=false,generation=generation+1,changed_at=clock_timestamp() "+
  "WHERE id=1 AND closed=true;");
 const changed=await store.execute(payload);
 ok(changed.revision===3,'real R165 authorized editor revision failed');
 const quarantiner=createR165QuarantineControl({pool});
 const closure=await quarantiner.close();
 ok(closure.closed===true&&closure.changed===true&&closure.generation===3,
  'operator did not durably close quarantine');
 let secondDenied=false;
 try{await store.execute({...payload,key:'16500000-0000-4165-8165-000000000602',
  data:{...payload.data,revision:3,title:'R165 Forbidden Reopen'}});}
 catch(e){secondDenied=e.status===503;}
 ok(secondDenied,'closed quarantine permitted second editor');
 ok((await quarantiner.status()).closed===true,'quarantine reopened after close');
 // Two distinct objects and SQL sessions race the same cryptographically
 // verified Ed25519 two-reviewer challenge.
 const signatures=['operator','independent-reviewer'].map(role=>{
  const pair=generateKeyPairSync('ed25519');
  return{role,privateKey:pair.privateKey,
   publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'})};
 });
 const targetDigest=createHash('sha256').update(Buffer.from(
  'r165-synthetic-target:'+commit+':'+bundle.sha256)).digest('hex');
 const packet=createR164DrillChallenge({commit,targetDigest,synthetic:true});
 const approvals=signatures.map(k=>({role:k.role,publicKeyPem:k.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),k.privateKey).toString('base64url')}));
 const pinnedReviewerFingerprints=Object.fromEntries(signatures.map(k=>
  [k.role,r164ReviewerFingerprint(k.publicKeyPem)]));
 const proof={packet,approvals,pinnedReviewerFingerprints,commit,targetDigest};
 const a=createR165DurableQuorum({pool}),b=createR165DurableQuorum({pool});
 const competing=await Promise.allSettled([a.consume(proof),b.consume(proof)]);
 ok(competing.filter(x=>x.status==='fulfilled').length===1&&
  competing.filter(x=>x.status==='rejected').length===1,
  'postgres unique nonce does not fence concurrent distinct workers');
 const sourceInventory=[
 "SELECT json_build_object(",
 "'nonceCount',(SELECT count(*) FROM marcosa_private.r165_drill_nonces),",
 "'quarantineClosed',(SELECT closed FROM marcosa_private.r165_quarantine WHERE id=1),",
 "'quarantineGeneration',(SELECT generation FROM marcosa_private.r165_quarantine WHERE id=1),",
 "'creatorRevision',(SELECT revision FROM public.marcosa_seasons WHERE id='"+season+"'::uuid),",
 "'commandCount',(SELECT count(*) FROM marcosa_private.r156_commands WHERE actor_id='"+actor+"'::uuid),",
 "'inboxRows',(SELECT count(*) FROM marcosa_private.r161_webhook_inbox),",
 "'inboxAcknowledgements',(SELECT sum(accepted_count) FROM marcosa_private.r161_webhook_inbox),",
 "'revokedSessions',(SELECT count(*) FROM auth.sessions WHERE id='16100000-0000-4161-8161-000000000502'::uuid),",
 "'activeSessions',(SELECT count(*) FROM auth.sessions WHERE id='"+session+"'::uuid),",
 "'nonceRls',(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.r165_drill_nonces'::regclass),",
 "'quarantineRls',(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.r165_quarantine'::regclass),",
 "'browserCanReadNonce',has_table_privilege('authenticated','marcosa_private.r165_drill_nonces','SELECT'),",
 "'browserCanReadQuarantine',has_table_privilege('authenticated','marcosa_private.r165_quarantine','SELECT'),",
 "'writerCanOpenGate',has_table_privilege('marcosa_r156_writer','marcosa_private.r165_quarantine','UPDATE')",
 ")::text;"
 ].join(' ');
 const source=JSON.parse(query('postgres',sourceInventory));
 const original=processRun('docker',['exec','-u','postgres',env.R165_SERVICE_CONTAINER,
  'pg_dump','-U','postgres','-d','postgres','--format=custom'],{timeout:45000});
 ok(Buffer.isBuffer(original)&&original.length>512&&original.length<=25*1024*1024,
  'unexpected native PostgreSQL backup length');
 const key=randomBytes(32);
 const sealed=sealR165Backup({plaintext:original,key,commit,bundleSha256:bundle.sha256});
 encryptedFile=join(env.RUNNER_TEMP,'r165-encrypted-only-backup.bin');
 await writeFile(encryptedFile,sealed.blob,{flag:'wx',mode:0o600});
 const moved=await readFile(encryptedFile);
 ok(createHash('sha256').update(moved).digest('hex')===sealed.encryptedSha256,
  'copied encrypted backup changed on disk');
 const decrypted=openR165Backup({blob:moved,key,commit,bundleSha256:bundle.sha256});
 ok(decrypted.verified&&decrypted.plaintext.equals(original),
  'encrypted archive roundtrip failed');
 let wrongKeyRejected=false,tamperingRejected=false;
 try{openR165Backup({blob:moved,key:randomBytes(32),commit,bundleSha256:bundle.sha256});}
 catch{wrongKeyRejected=true;}
 const changedBytes=Buffer.from(moved);
 changedBytes[changedBytes.length-22]^=1;
 try{openR165Backup({blob:changedBytes,key,commit,bundleSha256:bundle.sha256});}
 catch{tamperingRejected=true;}
 ok(wrongKeyRejected&&tamperingRejected,'AES-GCM negative checks failed');
 query('postgres','CREATE DATABASE marcosa_r165_restored TEMPLATE template0;');
 processRun('docker',['exec','-u','postgres','-i',env.R165_SERVICE_CONTAINER,
  'pg_restore','-U','postgres','--no-owner','--exit-on-error',
  '-d','marcosa_r165_restored'],{input:decrypted.plaintext,timeout:45000});
 const restored=JSON.parse(query('marcosa_r165_restored',sourceInventory));
 const bad=spawnSync('docker',['exec','-u','postgres','-i',env.R165_SERVICE_CONTAINER,
  'pg_restore','--list'],{input:Buffer.from('CORRUPT-R165-PGDUMP'),
  timeout:8000,env:{...env,...adminEnv}});
 const corruptArchiveRejected=bad.status!==0;
 const witness=verifyR165EncryptedRestore({
  commit,bundleSha256:bundle.sha256,encryptedSha256:sealed.encryptedSha256,
  source,restored,encryptedReadbackVerified:true,wrongKeyRejected,
  tamperingRejected,corruptArchiveRejected,checkpointAtMs,
  finishedAtMs:Date.now()
 });
 ok(witness.verified&&witness.quarantineRestoredClosed===true&&
  witness.productionAuthorized===false&&witness.realOffsiteRestoreVerified===false,
  'restored security evidence not accepted');
 await writeFile(join(env.RUNNER_TEMP,'r165-nonsecret-ci-report.json'),
  JSON.stringify({schemaVersion:1,commit,bundleSha256:bundle.sha256,
   encryptedSha256:sealed.encryptedSha256,witnessSha256:witness.proofSha256,
   nonceConsumedOnce:true,operatorQuarantineClosed:true,
   realPg17EncryptedRestore:true,offsiteVerified:false,
   liveSupabaseConnected:false,productionAuthorized:false},null,2)+'\n',
  {flag:'wx',mode:0o600});
 console.log('R165_DURABLE_SIGNED_NONCE_ONE_OF_TWO_WRITERS=PASS');
 console.log('R165_CLOSED_QUARANTINE_REVOKES_REAL_PG17_WRITES=PASS');
 console.log('R165_AES256_GCM_WRONG_KEY_AND_TAMPER_REJECTED=PASS');
 console.log('R165_ENCRYPTED_POSTGRES17_INDEPENDENT_RESTORE_RLS=PASS');
 console.log('R165_OFFSITE_AND_PRODUCTION=NO_GO');
}finally{
 if(encryptedFile)await rm(encryptedFile,{force:true});
 await pool.end();
}
