import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,symlink,link,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {readSealedR161Settings} from '../r161/sealed-config.mjs';

const config=()=>({staging:true,projectRef:'abcdefghijklmnopqrst',
 allowedOrigins:['https://staging.marcosa.example'],
 database:{host:'db.example.invalid',port:5432,name:'marcosa',role:'marcosa_gateway',
  maxConnections:3},
 secrets:{ca:'root-ca.pem',password:'db-password.txt',operatorToken:'operator-token.txt',
  webhookSecret:'webhook-key.txt'}});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'r161-secrets-'));await chmod(root,0o700);
 async function put(name,data){await writeFile(join(root,name),data,{mode:0o600});}
 await put('staging.txt',JSON.stringify(config()));
 await put('root-ca.pem',rootCertificates[0]);
 await put('db-password.txt','not-a-real-prod-db-secret-abcdefghijklmnopqrstuvwxyz');
 await put('operator-token.txt','not-real-secret-but-long-operator-key-abcdefghijklmnopqrstuvwxyz');
 await put('webhook-key.txt','not-real-secret-but-long-webhook-key-abcdefghijklmnopqrstuvwxyz');
 return{root,put,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('R161 private root, manifest and four separate files load without exposing secrets',async()=>{
 const f=await fixture();
 try{
  const v=await readSealedR161Settings({secretsRoot:f.root});
  assert.equal(v.pgConfig.expectedHost,'db.example.invalid');
  assert.equal(v.publicMetadata.secretCount,4);
  assert.equal(v.publicMetadata.productionReady,false);
  assert.doesNotMatch(JSON.stringify(v.publicMetadata),/password|not-real|operator/);
  assert.equal(v.settings.stage,'staging');
 }finally{await f.cleanup();}
});
test('R161 world-readable secrets, symlink and hardlink are always rejected',async()=>{
 const f=await fixture();
 try{
  await chmod(join(f.root,'db-password.txt'),0o644);
  await assert.rejects(readSealedR161Settings({secretsRoot:f.root}),/secure file unavailable/);
  await chmod(join(f.root,'db-password.txt'),0o600);
  await rm(join(f.root,'db-password.txt'));
  await symlink(join(f.root,'operator-token.txt'),join(f.root,'db-password.txt'));
  await assert.rejects(readSealedR161Settings({secretsRoot:f.root}),/secure file unavailable/);
  await rm(join(f.root,'db-password.txt'));
  await link(join(f.root,'operator-token.txt'),join(f.root,'db-password.txt'));
  await assert.rejects(readSealedR161Settings({secretsRoot:f.root}),/secure file unavailable/);
 }finally{await f.cleanup();}
});
test('R161 production stage, extra properties, traversal, unsafe permissions fail closed',async()=>{
 const f=await fixture();
 try{
  await f.put('staging.txt',JSON.stringify({...config(),staging:false}));
  await assert.rejects(readSealedR161Settings({secretsRoot:f.root}),/staging/);
  await f.put('staging.txt',JSON.stringify({...config(),extra:'prod'}));
  await assert.rejects(readSealedR161Settings({secretsRoot:f.root}),/manifest fields/);
  await f.put('staging.txt',JSON.stringify({...config(),secrets:{...config().secrets,ca:'../other'}}));
  await assert.rejects(readSealedR161Settings({secretsRoot:f.root}),/secure file/);
  await f.put('staging.txt',JSON.stringify(config()));
  await chmod(f.root,0o755);
  await assert.rejects(readSealedR161Settings({secretsRoot:f.root}),/private secret root/);
 }finally{await f.cleanup();}
});
