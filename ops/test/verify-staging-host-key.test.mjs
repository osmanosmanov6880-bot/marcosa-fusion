import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyStagingHostPin,verifyStagingHostPinFile} from '../verify-staging-host-key.mjs';

function pub(seed=9){
 const type=Buffer.from('ssh-ed25519'),point=Buffer.alloc(32,seed);
 const len=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
 const blob=Buffer.concat([len(type.length),type,len(point.length),point]);
 return{key:blob.toString('base64'),fingerprint:'SHA256:'+createHash('sha256').update(blob).digest('base64').replace(/=+$/,'')};
}
test('R70 offline staging ED25519 pin: exact hostname and port, provider proof cannot be inferred',()=>{
 const {key,fingerprint}=pub(),host='staging.marcosa.example',port=2222;
 const record='['+host+']:'+port+' ssh-ed25519 '+key+' verified-in-owner-console';
 const result=verifyStagingHostPin({hostname:host,port,knownHosts:record,expected:fingerprint});
 assert.equal(result.localMatch,true);
 assert.equal(result.providerProvenanceVerifiedByTool,false);
 assert.equal(result.networkContacted,false);
 assert.equal(result.hostTag,'['+host+']:'+port);
 assert.equal(result.fingerprint,fingerprint);
 assert.equal(result.algorithm,'ssh-ed25519');
 assert.deepEqual(Object.keys(result).sort(),['algorithm','fingerprint','hostTag','hostname','localMatch','networkContacted','port','providerProvenanceVerifiedByTool']);
 assert.throws(()=>verifyStagingHostPin({hostname:'other.example',port,knownHosts:record,expected:fingerprint}),/No ED25519 host pin/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port:22,knownHosts:record,expected:fingerprint}),/No ED25519 host pin/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:record,expected:pub(4).fingerprint}),/fingerprint mismatch/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:record+'\n'+record,expected:fingerprint}),/Ambiguous host key/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:'@revoked ['+host+']:'+port+' ssh-ed25519 '+key+'\n'+record,expected:fingerprint}),/Revoked/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:'@cert-authority ['+host+']:'+port+' ssh-ed25519 '+key+'\n'+record,expected:fingerprint}),/unsupported/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:'['+host+']:'+port+' ssh-rsa '+key,expected:fingerprint}),/algorithm/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:'*.example ssh-ed25519 '+key,expected:fingerprint}),/No ED25519 host pin/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:record,expected:'SHA256:unsafe'}),/Expected independently verified/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:'['+host+']:'+port+' ssh-ed25519 not:base64',expected:fingerprint}),/base64/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:'['+host+']:'+port+' ssh-ed25519 '+Buffer.alloc(2).toString('base64'),expected:fingerprint}),/Invalid SSH wire/);
 assert.throws(()=>verifyStagingHostPin({hostname:'..',port,knownHosts:record,expected:fingerprint}),/Invalid staging hostname/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port:65536,knownHosts:record,expected:fingerprint}),/Invalid SSH port/);
 assert.throws(()=>verifyStagingHostPin({hostname:host,port,knownHosts:record,expected:fingerprint+'='}),/Expected independently verified/);
 const port22='staging.example.net ssh-ed25519 '+key;
 assert.equal(verifyStagingHostPin({hostname:'staging.example.net',knownHosts:port22,expected:fingerprint}).port,22);
});
test('R70 operator local file verification and CLI reject tampering and symlink',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r70-pin-'));
 const {key,fingerprint}=pub(25),host='staging.example.net';
 const path=join(dir,'known_hosts');
 try{
  writeFileSync(path,host+' ssh-ed25519 '+key+'\n',{mode:0o600});
  const verified=verifyStagingHostPinFile({hostname:host,path,expected:fingerprint});
  assert.equal(verified.localMatch,true);
  const cli=spawnSync(process.execPath,['ops/verify-staging-host-key.mjs','--hostname',host,
   '--known-hosts',path,'--expected',fingerprint],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
  const response=JSON.parse(cli.stdout);
  assert.equal(response.ok,true);assert.equal(response.providerProvenanceVerifiedByTool,false);
  assert.equal(response.networkContacted,false);
  const wrong=spawnSync(process.execPath,['ops/verify-staging-host-key.mjs','--hostname',host,
   '--known-hosts',path,'--expected',pub(11).fingerprint],{encoding:'utf8'});
  assert.equal(wrong.status,1);
  assert.doesNotMatch(wrong.stdout,/ok/);
  const link=join(dir,'linked_hosts');symlinkSync(path,link);
  assert.throws(()=>verifyStagingHostPinFile({hostname:host,path:link,expected:fingerprint}),/non-symlink/);
  assert.throws(()=>verifyStagingHostPinFile({hostname:host,path:dir,expected:fingerprint}),/regular non-symlink/);
  writeFileSync(path,host+' ssh-ed25519 '+pub(99).key+'\n');
  assert.throws(()=>verifyStagingHostPinFile({hostname:host,path,expected:fingerprint}),/fingerprint mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
