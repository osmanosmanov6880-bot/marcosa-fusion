import test from 'node:test';
import assert from 'node:assert/strict';
import {
 mkdtempSync,lstatSync,readFileSync,writeFileSync,copyFileSync,statSync,symlinkSync,
 rmSync,existsSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createApp} from '../../server-lab/server.mjs';
import {backupLocal,verifyDatabase,sha256} from '../local-backup-restore.mjs';
import {sealSnapshot,unsealSnapshot,ARCHIVE_FORMAT} from '../encrypted-local-archive.mjs';
import {encryptedRecoveryDrill} from '../encrypted-recovery-drill.mjs';

test('R73 real SQLite with users, PNG, complaint and consent: authenticated encryption, recovery, tamper, wrong key and fail-closed output',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r73-'));
 const live=join(dir,'live.sqlite'),plain=join(dir,'snapshot.sqlite'),archive=join(dir,'sealed.marc'),
  archive2=join(dir,'second.marc'),restored=join(dir,'restored.sqlite');
 const key=join(dir,'password-private'),wrongKey=join(dir,'password-wrong'),
  looseKey=join(dir,'password-permissive');
 writeFileSync(key,'a-strong-distinct-offline-passphrase-for-r73-2026',{mode:0o600});
 writeFileSync(wrongKey,'a-completely-different-passphrase-for-r73',{mode:0o600});
 writeFileSync(looseKey,'a-strong-distinct-offline-passphrase-for-r73-2026',{mode:0o644});
 let app=null,copy=null;
 try{
  app=createApp({databasePath:live});
  await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
  const owner='11111111-2222-4333-8444-555555555555',
   reviewer='33333333-4444-4555-8666-777777777777',
   reporter='99999999-4444-4555-8666-888888888888',world='r73-world';
  const user=app.db.prepare('INSERT INTO users(id,email,username,salt,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)');
  user.run(owner,'private-owner@example.invalid','owner73','0'.repeat(32),'a'.repeat(128),'member',100);
  user.run(reviewer,'private-reviewer@example.invalid','review73','1'.repeat(32),'b'.repeat(128),'moderator',100);
  user.run(reporter,'private-reporter@example.invalid','reporter73','2'.repeat(32),'c'.repeat(128),'member',100);
  app.db.prepare('INSERT INTO worlds(id,owner_id,slug,title,description,created_at) VALUES(?,?,?,?,?,?)')
   .run(world,owner,'r73-world','Secret World R73','Private metadata kept inside encrypted storage',120);
  const binary=Buffer.from('R73 PRIVATE IMAGE BLOB WITH UNSAFE METADATA '+ 'x'.repeat(100),'utf8');
  app.db.prepare('INSERT INTO world_covers(world_id,png,width,height,byte_size,updated_at,review_status,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(world,binary,2,2,binary.length,180,'approved',reviewer,200);
  app.db.prepare('INSERT INTO world_cover_reports(world_id,reporter_id,cover_sha256,reason,detail,created_at) VALUES(?,?,?,?,?,?)')
   .run(world,reporter,createHash('sha256').update(binary).digest('hex'),'privacy',
    'Personal image privacy complaint',210);
  app.db.prepare('INSERT INTO beta_retention_consents(user_id,consented_at,consented_day) VALUES(?,?,?)')
   .run(owner,172800000,2);
  app.db.prepare("INSERT INTO beta_retention_days(user_id,day_utc,source) VALUES(?,?,'consent')").run(owner,2);
  assert.equal(verifyDatabase(live).integrity,'ok');
  // R73 large-block one-command tool uses an isolated private directory,
  // encrypts and actually reopens the restored database before publishing.
  const oneShot=join(dir,'one-shot.marc'),standaloneRestore=join(dir,'one-shot.sqlite');
  const run=await encryptedRecoveryDrill({database:live,destination:oneShot,passphrasePath:key});
  assert.equal(run.ok,true);
  assert.equal(run.encrypted,true);
  assert.equal(run.isolatedRecoveryPassed,true);
  assert.equal(run.sha256Matches,true);
  assert.equal(lstatSync(oneShot).mode&0o777,0o600);
  const restoredOneShot=await unsealSnapshot({archive:oneShot,destination:standaloneRestore,passphrasePath:key});
  assert.equal(restoredOneShot.verification.integrity,'ok');
  assert.equal(await sha256(standaloneRestore),await sha256(live));
  assert.equal((await import('node:fs')).readdirSync(dir).some(x=>x.startsWith('.marcosa-encrypted-drill-')),false,'No plaintext drill directory may persist');
  await assert.rejects(()=>encryptedRecoveryDrill({database:live,destination:oneShot,passphrasePath:key}),/already exists/);
  const snap=await backupLocal({source:live,destination:plain});
  assert.equal(snap.verification.integrity,'ok');
  const first=await sealSnapshot({backup:plain,manifest:plain+'.json',destination:archive,passphrasePath:key});
  assert.equal(first.encrypted,true);
  assert.equal(first.format,ARCHIVE_FORMAT);
  assert.equal(first.algorithm,'AES-256-GCM');
  assert.equal(lstatSync(archive).mode&0o777,0o600);
  const sealed=readFileSync(archive);
  for(const secret of ['private-owner@example.invalid','Secret World R73','R73 PRIVATE IMAGE BLOB','Personal image privacy complaint'])
   assert.equal(sealed.includes(Buffer.from(secret)),false,'Plaintext leaked in encrypted archive: '+secret);
  assert.equal(sealed.subarray(0,8).toString('ascii'),ARCHIVE_FORMAT);
  assert.ok(sealed.length>100);

  const second=await sealSnapshot({backup:plain,manifest:plain+'.json',destination:archive2,passphrasePath:key});
  assert.notEqual(await sha256(archive),await sha256(archive2),'Unique salt/IV per encryption');
  assert.equal(second.encrypted,true);
  assert.equal(statSync(archive).size,statSync(archive2).size);
  assert.equal(lstatSync(archive2).mode&0o777,0o600);
  const proof=await unsealSnapshot({archive,destination:restored,passphrasePath:key});
  assert.equal(proof.verification.integrity,'ok');
  assert.equal(proof.sourceDigest,await sha256(plain));
  assert.equal(proof.bytes,statSync(plain).size);
  assert.equal(lstatSync(restored).mode&0o777,0o600);
  assert.equal(await sha256(restored),await sha256(plain));

  await app.close();app=null;
  copy=createApp({databasePath:restored});
  await new Promise(ok=>copy.server.listen(0,'127.0.0.1',ok));
  assert.equal(copy.db.prepare('SELECT count(*) AS n FROM users').get().n,3);
  assert.equal(copy.db.prepare('SELECT count(*) AS n FROM world_cover_reports').get().n,1);
  assert.equal(copy.db.prepare('SELECT count(*) AS n FROM beta_retention_days').get().n,1);
  assert.ok(Buffer.from(copy.db.prepare('SELECT png FROM world_covers').get().png).equals(binary));
  assert.deepEqual(copy.db.prepare('PRAGMA foreign_key_check').all(),[]);
  await copy.close();copy=null;

  await assert.rejects(()=>unsealSnapshot({archive,destination:restored,passphrasePath:key}),/already exists/);
  await assert.rejects(()=>sealSnapshot({backup:plain,manifest:plain+'.json',destination:archive,passphrasePath:key}),/already exists/);
  await assert.rejects(()=>unsealSnapshot({archive,destination:join(dir,'wrong.sqlite'),passphrasePath:wrongKey}),/Authentication failed/);
  assert.equal(existsSync(join(dir,'wrong.sqlite')),false);
  await assert.rejects(()=>sealSnapshot({backup:plain,manifest:plain+'.json',destination:join(dir,'unsafe.marc'),passphrasePath:looseKey}),/private/);
  const corrupted=join(dir,'corrupted.marc');copyFileSync(archive,corrupted);
  const tampered=readFileSync(corrupted);tampered[Math.floor(tampered.length/2)]^=0x80;writeFileSync(corrupted,tampered);
  await assert.rejects(()=>unsealSnapshot({archive:corrupted,destination:join(dir,'corrupted.sqlite'),passphrasePath:key}),/Authentication failed/);
  assert.equal(existsSync(join(dir,'corrupted.sqlite')),false);
  const damagedTag=join(dir,'bad-tag.marc');copyFileSync(archive,damagedTag);
  const bad=readFileSync(damagedTag);bad[bad.length-1]^=0x80;writeFileSync(damagedTag,bad);
  await assert.rejects(()=>unsealSnapshot({archive:damagedTag,destination:join(dir,'bad-tag.sqlite'),passphrasePath:key}),/Authentication failed/);
  const sym=join(dir,'link.marc');symlinkSync(archive,sym);
  await assert.rejects(()=>unsealSnapshot({archive:sym,destination:join(dir,'linked.sqlite'),passphrasePath:key}),/non-symlink/);
  const dangling=join(dir,'dangling.sqlite');symlinkSync(join(dir,'missing'),dangling);
  await assert.rejects(()=>unsealSnapshot({archive,destination:dangling,passphrasePath:key}),/already exists/);
  const disguised=join(dir,'fake-key');symlinkSync(key,disguised);
  await assert.rejects(()=>unsealSnapshot({archive,destination:join(dir,'disguised.sqlite'),passphrasePath:disguised}),/non-symlink/);

  const cli=join(process.cwd(),'ops','encrypted-local-archive.mjs'),cliArchive=join(dir,'cli-archive.marc');
  const result=JSON.parse(execFileSync(process.execPath,[cli,'seal','--db',plain,'--manifest',plain+'.json',
   '--out',cliArchive,'--passphrase-file',key],{encoding:'utf8'}));
  assert.equal(result.ok,true);assert.equal(result.encrypted,true);
  const failed=spawnSync(process.execPath,[cli,'unseal','--archive',cliArchive,'--out',join(dir,'cli-wrong.sqlite'),
   '--passphrase-file',wrongKey],{encoding:'utf8'});
  assert.equal(failed.status,1);
  assert.doesNotMatch(failed.stderr,/a-completely-different-passphrase|private-owner@example.invalid/);
  const cliRestore=join(dir,'cli-restored.sqlite');
  const cliResult=JSON.parse(execFileSync(process.execPath,[cli,'unseal','--archive',cliArchive,
   '--out',cliRestore,'--passphrase-file',key],{encoding:'utf8'}));
  assert.equal(cliResult.ok,true);
  assert.equal(await sha256(cliRestore),await sha256(plain));
 }finally{
  if(app)await app.close().catch(()=>{});
  if(copy)await copy.close().catch(()=>{});
  rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
 }
});
