import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,readFile,writeFile,symlink,link,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {sealR165Backup} from '../r165/encrypted-backup.mjs';
import {createR166EvidenceVault} from '../r166/evidence-vault.mjs';
const commit='a'.repeat(40),bundleSha256='b'.repeat(64);
const blob=()=>sealR165Backup({plaintext:Buffer.concat([Buffer.from('PGDMP'),
 randomBytes(4096)]),key:randomBytes(32),commit,bundleSha256}).blob;
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'r166-vault-'));
 await chmod(root,0o700);
 return{root,vault:createR166EvidenceVault({root}),done:()=>rm(root,{recursive:true,force:true})};
}
test('R166 atomic private encrypted vault, readback, no overwrite and independent local copy',async()=>{
 const a=await fixture(),b=await fixture();
 try{
  const bytes=blob(),e=await a.vault.putEncrypted({blob:bytes});
  assert.equal(e.locallyFsynced,true);assert.equal(e.offsiteVerified,false);
  assert.ok((await a.vault.readEncrypted({sha256:e.sha256})).bytes.equals(bytes));
  await assert.rejects(a.vault.putEncrypted({blob:bytes}),/exclusive encrypted write/);
  assert.equal((await a.vault.replicateTo({sha256:e.sha256,targetVault:b.vault})).copiedAndReadBack,true);
  assert.ok((await b.vault.readEncrypted({sha256:e.sha256})).bytes.equals(bytes));
 }finally{await a.done();await b.done();}
});
test('R166 rejects plaintext, world readable directory, bad digest, symlinks and hardlinks',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(f.vault.putEncrypted({blob:Buffer.alloc(4096)}),/encrypted backup/);
  const e=await f.vault.putEncrypted({blob:blob()});
  await assert.rejects(f.vault.readEncrypted({sha256:'../credential'}),/digest/);
  await chmod(f.root,0o755);
  await assert.rejects(f.vault.readEncrypted({sha256:e.sha256}),/private vault/);
  await chmod(f.root,0o700);
  const target=join(f.root,e.sha256+'.r165enc');
  const bytes=await readFile(target);
  const bad=Buffer.from(bytes);bad[bad.length-20]^=1;
  await writeFile(target,bad);
  await assert.rejects(f.vault.readEncrypted({sha256:e.sha256}),/compromised/);
 }finally{await f.done();}
});
