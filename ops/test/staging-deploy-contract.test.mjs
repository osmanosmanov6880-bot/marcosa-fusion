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
test('R83: only explicitly confirmed main-dispatch may reach isolated SSH staging',()=>{
 const actual=validateStagingDispatch(good);
 assert.equal(actual.sourceTrustedForStaging,true);
 assert.equal(actual.destination,'isolated static STAGING only');
 assert.equal(actual.productionAuthorized,false);
 assert.equal(actual.providerHostProvenanceVerified,false);
 assert.equal(actual.requiresIndependentEnvironmentReviewer,true);
 for(const [field,bad] of [
  ['repository','other/repository'],['eventName','push'],['eventName','pull_request'],
  ['eventName','schedule'],['ref','refs/heads/feature/ssh'],
  ['ref','refs/tags/v1'],['sha','b'.repeat(7)],['sha','c'.repeat(39)+'X'],
  ['confirmation','DEPLOY-PRODUCTION'],['confirmation',undefined],
  ['environment','production']
 ]){
  assert.throws(()=>validateStagingDispatch({...good,[field]:bad}),Error,field);
 }
 assert.throws(()=>validateStagingDispatch(),Error);
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
test('R83: actual workflow has no auto SSH deploy or keyscan, and validates host in both steps',()=>{
 const workflow=readFileSync('.github/workflows/marcosa-staging.yml','utf8');
 const diagnostic=readFileSync('scripts/diagnose-staging-ssh.sh','utf8');
 const contract=readFileSync('ops/staging-deploy-contract.mjs','utf8');
 assert.match(workflow,/workflow_dispatch:\s*\n\s*inputs:/);
 assert.match(workflow,/github.event_name == 'workflow_dispatch' && inputs.confirmation == 'DEPLOY-MARCOSA-STAGING'/);
 assert.match(workflow,/environment: marcosa-staging/);
 assert.equal(workflow.split('node ops\/verify-staging-host-key.mjs').length,2,
  'The uploader must verify exactly once and preflight verifies independently');
 assert.equal(workflow.split('MARCOSA_STAGING_HOST_FINGERPRINT').length-1,2);
 assert.match(diagnostic,/node ops\/verify-staging-host-key.mjs/);
 assert.doesNotMatch(diagnostic,/\bssh-keyscan\s+-/);
 assert.match(workflow,/StrictHostKeyChecking=yes/);
 assert.match(diagnostic,/StrictHostKeyChecking=yes/);
 assert.match(contract,/productionAuthorized:false/);
 const check=spawnSync('bash',['-n','scripts/diagnose-staging-ssh.sh'],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
});
