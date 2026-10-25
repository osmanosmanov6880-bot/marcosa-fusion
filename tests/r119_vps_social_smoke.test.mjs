import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {runSocialSmoke} from '../ops/r119_social_smoke.mjs';

const sha='a'.repeat(40);
test('R119 actual Node+SQLite HTTP API, strict 127.0.0.1, synthetic only',async()=>{
  const result=await runSocialSmoke({releaseSha:sha});
  assert.equal(result.releaseSha,sha);
  assert.equal(result.labAccountsSynthetic,2);
  assert.equal(result.verifiedListener,'127.0.0.1');
  for(const property of ['actualHttpTests','twoAccountFollowAndCommentVerified','crossTenantWriteRejected',
    'guestPrivateExportRejected','wrongHostRejected','hostileOriginRejected',
    'ownerOnlyExport','accountDeletionAndSessionRevocation',
    'sqliteForeignKeysValid','sqliteQuickCheckValid']){
    assert.equal(result[property],true,'missing independent proof: '+property);
  }
  for(const property of ['productionAuthorized','productionAccountMigrationVerified',
    'postgresOrSupabaseVerified','paymentsVerified','accountDataPersisted',
    'publicNetworkListener']){
    assert.equal(result[property],false,'must not authorize '+property);
  }
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/(password|token|cookie|service_role|user@)/i);
});
test('R119 rejects missing or shortened source sha before starting server',async()=>{
  await assert.rejects(()=>runSocialSmoke({releaseSha:''}),/40-character/);
  await assert.rejects(()=>runSocialSmoke({releaseSha:'f'.repeat(39)}),/40-character/);
  await assert.rejects(()=>runSocialSmoke({releaseSha:'0'.repeat(39)+'x'}),/40-character/);
});
test('R119 CLI emits only synthetic/protected proof labels',()=>{
  const child=spawnSync(process.execPath,['ops/r119_social_smoke.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000,
    env:{...process.env,RELEASE_SHA:sha},
  });
  assert.equal(child.status,0,'Failed R119 CLI: '+child.stderr.slice(0,400));
  assert.match(child.stdout,/R119_ACTUAL_VPS_EPHEMERAL_SOCIAL_API=PASS/);
  assert.match(child.stdout,/R119_LISTENER=127.0.0.1_EPHEMERAL/);
  assert.match(child.stdout,/R119_PRODUCTION_AUTHORIZED=NO/);
  assert.doesNotMatch(child.stdout,/(password|marcosa_session=|Cookie:|inviteCode|PRIVATE)/);
});
test('R119 refuses execution without exact main SHA',()=>{
  const child=spawnSync(process.execPath,['ops/r119_social_smoke.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000,
    env:{...process.env,RELEASE_SHA:''},
  });
  assert.notEqual(child.status,0);
  assert.match(child.stderr,/R119_EPHEMERAL_LAB_FAILED/);
  assert.doesNotMatch(child.stdout,/PASS/);
});
test('VPS workflow never binds public port, uses no sudo, and purges temp source',()=>{
  const file=readFileSync(new URL('../.github/workflows/marcosa-r119-vps-social-smoke.yml',import.meta.url),'utf8');
  assert.match(file,/environment: marcosa-staging/);
  assert.match(file,/StrictHostKeyChecking=yes/);
  assert.match(file,/source ops\/load-pinned-staging-host.sh/);
  assert.match(file,/expected source SHA/i);
  assert.match(file,/rm -rf --/);
  assert.match(file,/server-lab\/?/);
  assert.match(file,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.doesNotMatch(file,/sudo\s|systemctl|nginx -s reload|rsync --delete|0\.0\.0\.0/);
});
