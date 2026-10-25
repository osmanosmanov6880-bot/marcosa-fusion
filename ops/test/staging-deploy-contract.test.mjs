import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validateStagingDispatch,STAGING_REPO,STAGING_APPROVAL} from '../staging-deploy-contract.mjs';
import {verifyStagingHostPin} from '../verify-staging-host-key.mjs';

const good={
 repository:STAGING_REPO,eventName:'workflow_dispatch',ref:'refs/heads/main',
 sha:'b'.repeat(40),confirmation:STAGING_APPROVAL,environment:'marcosa-staging'
};
test('R91: trusted main push and explicitly confirmed manual dispatch only reach isolated SSH staging',()=>{
 const actual=validateStagingDispatch(good);
 assert.equal(actual.sourceTrustedForStaging,true);
 assert.equal(actual.destination,'isolated static STAGING only');
 assert.equal(actual.productionAuthorized,false);
 assert.equal(actual.providerHostProvenanceVerified,false);
 assert.equal(actual.requiresIndependentEnvironmentReviewer,true);
 assert.equal(actual.requiresPinnedHostAndIndependentHttpsReadback,true);
 const automatic=validateStagingDispatch({...good,eventName:'push',confirmation:undefined});
 assert.equal(automatic.trigger,'trusted-main-push');
 assert.equal(automatic.productionAuthorized,false);
 for(const [field,bad] of [
  ['repository','other/repository'],['eventName','pull_request'],
  ['eventName','schedule'],['ref','refs/heads/feature/ssh'],
  ['ref','refs/tags/v1'],['sha','b'.repeat(7)],['sha','c'.repeat(39)+'X'],
  ['confirmation','DEPLOY-PRODUCTION'],['confirmation',undefined],
  ['environment','production']
 ]){
  assert.throws(()=>validateStagingDispatch({...good,[field]:bad}),Error,field);
 }
 assert.throws(()=>validateStagingDispatch({...good,eventName:'push',confirmation:STAGING_APPROVAL}),Error);
 assert.throws(()=>validateStagingDispatch({...good,eventName:'schedule',confirmation:undefined}),Error);
 assert.throws(()=>validateStagingDispatch({...good,eventName:'push',ref:'refs/heads/feature/foo',confirmation:undefined}),Error);
 assert.throws(()=>validateStagingDispatch(),Error);
});
test('R92: staging, SSH preflight and manual rollback use only the approved deploy key',()=>{
 const workflows=['marcosa-staging.yml','marcosa-ssh-preflight.yml','marcosa-staging-rollback.yml'];
 for(const name of workflows){
  const workflow=readFileSync('.github/workflows/'+name,'utf8');
  assert.match(workflow,/secrets\.DEPLOY_SSH_KEY/);
  assert.doesNotMatch(workflow,/secrets\.MARCOSA_SSH_KEY/);
  assert.match(workflow,/source ops\/load-pinned-staging-host\.sh/);
  assert.match(workflow,/SHA256:b6e0zrGwnTCu5yo9IZstiPw\+5EGfahHgVpI3TWeccA0/);
  assert.match(workflow,/169\.58\.48\.38/);
 }
 const preflight=readFileSync('scripts/diagnose-staging-ssh.sh','utf8');
 assert.match(preflight,/WRONG_DEPLOY_KEY/);
 assert.match(preflight,/WRONG_VPS/);
 assert.match(preflight,/StrictHostKeyChecking=yes/);
 const rollback=readFileSync('.github/workflows/marcosa-staging-rollback.yml','utf8');
 assert.match(rollback,/verify-staging-host-key.mjs/);
});
test('R96: committed MARCOSA host pin matches independently trusted ED25519 fingerprint',()=>{
 const pin=readFileSync('ops/ssh/marcosa-staging-known-hosts','utf8');
 const fp='SHA256:3VwLDjaMbBL/0AkWPjvaJo0gF1wRk/6g+ZJze+5toZA';
 const verified=verifyStagingHostPin({hostname:'169.58.48.38',port:22,knownHosts:pin,expected:fp});
 assert.equal(verified.localMatch,true);
 assert.equal(verified.networkContacted,false);
 assert.throws(()=>verifyStagingHostPin({hostname:'169.58.44.114',port:22,knownHosts:pin,expected:fp}),Error);
 const loader=readFileSync('ops/load-pinned-staging-host.sh','utf8');
 assert.match(loader,/verifyStagingHostPin/);
 assert.doesNotMatch(loader,/ssh-keyscan\s+-/);
});
test('R83: provider-supplied full known_hosts is fingerprint-verified on the exact port; first contact cannot establish trust',()=>{
 const type=Buffer.from('ssh-ed25519'),point=Buffer.alloc(32,19),len=n=>{
  const v=Buffer.alloc(4);v.writeUInt32BE(n);return v;
 };
 const blob=Buffer.concat([len(type.length),type,len(point.length),point]);
 const b64=blob.toString('base64');
 const expected='SHA256:'+createHash('sha256').update(blob).digest('base64').replace(/=+$/,'');
 const hostname='staging.example.net',port=2222,record='['+hostname+']:'+port+' ssh-ed25519 '+b64;
 const verified=verifyStagingHostPin({hostname,port,knownHosts:record,expected});
 assert.equal(verified.localMatch,true);
 assert.equal(verified.providerProvenanceVerifiedByTool,false);
 assert.equal(verified.networkContacted,false);
 for(const options of [
  {knownHosts:'ssh-ed25519 '+b64},
  {knownHosts:expected},
  {port:22},
  {expected:'SHA256:'+('A'.repeat(43))},
  {knownHosts:'@revoked '+record+'\n'+record},
  {knownHosts:record+'\n'+record}
 ])assert.throws(()=>verifyStagingHostPin({hostname,port,knownHosts:record,expected,...options}),Error);
});
test('R91: workflow auto-delivers trusted main after build and checks pinned SSH plus external hosted bytes',()=>{
 const workflow=readFileSync('.github/workflows/marcosa-staging.yml','utf8');
 const diagnostic=readFileSync('scripts/diagnose-staging-ssh.sh','utf8');
 const contract=readFileSync('ops/staging-deploy-contract.mjs','utf8');
 assert.match(workflow,/workflow_dispatch:\s*\n\s*inputs:/);
 assert.match(workflow,/github.event_name == 'push' \|\| \(github.event_name == 'workflow_dispatch'/);
 assert.match(workflow,/inputs.confirmation == 'DEPLOY-MARCOSA-STAGING'/);
 assert.match(workflow,/needs: build/);
 assert.match(workflow,/Independently verify hosted STAGING HTTPS bytes/);
 assert.match(workflow,/staging-expected-/);
 assert.match(workflow,/--manifest-sha256/);
 assert.match(workflow,/Roll back isolated STAGING when external HTTPS readback fails/);
 assert.match(workflow,/environment: marcosa-staging/);
 assert.equal(workflow.split('node ops\/verify-staging-host-key.mjs').length,3,
  'The uploader must verify exactly once and preflight verifies independently');
 assert.equal(workflow.split('source ops/load-pinned-staging-host.sh').length-1,3);
 assert.match(diagnostic,/node ops\/verify-staging-host-key.mjs/);
 assert.doesNotMatch(diagnostic,/\bssh-keyscan\s+-/);
 assert.match(workflow,/StrictHostKeyChecking=yes/);
 assert.match(diagnostic,/StrictHostKeyChecking=yes/);
 assert.match(contract,/productionAuthorized:false/);
 const check=spawnSync('bash',['-n','scripts/diagnose-staging-ssh.sh'],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
});
