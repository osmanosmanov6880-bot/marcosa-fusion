import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {auditCurrentSource,parseLegacyReadOnlyReport,FORMAT,COMPONENTS}
  from '../ops/r132_current_main_readonly_parity.mjs';

const SHA='a'.repeat(40),OLD='b'.repeat(64),CURRENT='c'.repeat(64);
const baseline=[
 'ROOT_PATH=/opt/marcosa/current',
 'ROOT_OWNER=root:root',
 'DEPLOY_USER_CAN_WRITE_PRODUCTION=NO',
 'LIVE_INDEX_SHA256='+OLD,
 'LIVE_INDEX_BYTES=34567',
 'LIVE_TOPLEVEL_SOURCE_COUNT=34',
 'PRODUCTION_COMPONENT_PRESENT=marcosa-config.js',
 'PRODUCTION_COMPONENT_PRESENT=marcosa-supabase.js',
 'PRODUCTION_COMPONENT_PRESENT=interaction-bridge.js',
 'PRODUCTION_COMPONENT_PRESENT=developer-console.js',
 'PRODUCTION_COMPONENT_PRESENT=nexus.js',
 'PRODUCTION_DISTINCT_COMPONENT_COUNT=5',
 'PRODUCTION_AUDIT_ONLY=YES',
];
const raw=()=>baseline.join('\n')+'\n';
const data=()=>({
 sourceSha:SHA,sourceIndexSha:CURRENT,sourceIndexBytes:33000,
 remote:raw(),
});
const change=(a,find,replacement)=>{
 const x=a.indexOf(find);
 if(x<0)throw Error('R132 test fixture line unavailable');
 a[x]=replacement;
};
const bad=(name,mutator,regex)=>test(name,()=>{
 const x=data();mutator(x);
 assert.throws(()=>auditCurrentSource(x),regex);
});
test('R132 audits same-run old root WITHOUT granting production GO',()=>{
 const r=auditCurrentSource(data());
 assert.equal(r.format,FORMAT);
 assert.equal(r.sourceSha,SHA);
 assert.equal(r.scope,'read_only_legacy_root_vs_exact_main_public_source');
 assert.equal(r.currentMainSourceIndexSha256,CURRENT);
 assert.equal(r.liveLegacyIndexSha256,OLD);
 assert.equal(r.indexBytesIdenticalWithCurrentSource,false);
 assert.equal(r.observedLegacyComponents.length,5);
 assert.equal(r.missingCriticalLegacyComponents.length,0);
 assert.equal(r.productionCutoverAuthorized,false);
 assert.equal(r.productionDecision,'NO_GO');
 assert.equal(r.authJwtCookiesAndApiRuntimeParityProven,false);
 assert.equal(r.deployedPreviewArtifactIndependentlyAttested,false);
});
test('R132 identical public index SOURCE still cannot authorize migration',()=>{
 const x=data();
 x.sourceIndexSha=OLD;x.sourceIndexBytes=34567;
 const p=auditCurrentSource(x);
 assert.equal(p.indexBytesIdenticalWithCurrentSource,true);
 assert.equal(p.liveCompatibilityProven,false);
 assert.equal(p.productionDecision,'NO_GO');
});
test('R132 count of legacy components is distinct and bounded',()=>{
 const p=parseLegacyReadOnlyReport(raw());
 assert.deepEqual(p.observedLegacyComponents,
   ['developer-console.js','interaction-bridge.js','marcosa-config.js',
    'marcosa-supabase.js','nexus.js']);
 assert.equal(p.deploymentAccountCannotWriteProduction,true);
 assert.equal(p.topLevelFileCount,34);
});
bad('rejects stale/short source SHA',p=>{p.sourceSha='1234'},/40-character/);
bad('rejects short source index checksum',p=>{p.sourceIndexSha='deadbeef'},/index SHA-256/);
bad('rejects oversized source index',p=>{p.sourceIndexBytes=100000000},/index SHA-256/);
bad('rejects empty remote stdout',p=>{p.remote=''},/bounded remote/);
bad('rejects truncated component count',p=>{
 const a=baseline.slice();change(a,'PRODUCTION_DISTINCT_COMPONENT_COUNT=5',
  'PRODUCTION_DISTINCT_COMPONENT_COUNT=4');p.remote=a.join('\n')+'\n';
},/does not match/);
bad('rejects missing real index digest',p=>{
 const a=baseline.slice();change(a,'LIVE_INDEX_SHA256='+OLD,
  'LIVE_INDEX_SHA256=none');p.remote=a.join('\n')+'\n';
},/index SHA-256/);
bad('rejects nonroot production root',p=>{
 const a=baseline.slice();change(a,'ROOT_OWNER=root:root','ROOT_OWNER=deploy:deploy');
 p.remote=a.join('\n')+'\n';
},/ownership/);
bad('rejects wrong production root directory',p=>{
 const a=baseline.slice();change(a,'ROOT_PATH=/opt/marcosa/current',
  'ROOT_PATH=/tmp/fake');p.remote=a.join('\n')+'\n';
},/ownership/);
bad('rejects writable production webroot',p=>{
 const a=baseline.slice();change(a,'DEPLOY_USER_CAN_WRITE_PRODUCTION=NO',
  'DEPLOY_USER_CAN_WRITE_PRODUCTION=YES');p.remote=a.join('\n')+'\n';
},/read-only boundary/);
bad('rejects script that did not prove audit-only',p=>{
 const a=baseline.slice();change(a,'PRODUCTION_AUDIT_ONLY=YES',
  'PRODUCTION_AUDIT_ONLY=NO');p.remote=a.join('\n')+'\n';
},/read-only boundary/);
bad('rejects duplicated remote key',p=>{
 p.remote=raw()+'LIVE_INDEX_BYTES=34567\n';
},/Duplicate/);
bad('rejects unknown key instead of accidentally echoing secrets',p=>{
 p.remote=raw()+'ACCESS_TOKEN=SECRET-NOT-FOR-LOGS\n';
},/Unknown or malformed/);
bad('rejects unapproved legacy filename',p=>{
 p.remote=raw().replace('PRODUCTION_COMPONENT_PRESENT=nexus.js',
  'PRODUCTION_COMPONENT_PRESENT=secrets.json');
},/Unexpected or duplicated/);
bad('rejects duplicate legacy component',p=>{
 p.remote=raw()+'PRODUCTION_COMPONENT_PRESENT=nexus.js\n';
},/Unexpected or duplicated/);
bad('rejects missing required proof field',p=>{
 p.remote=raw().replace('PRODUCTION_AUDIT_ONLY=YES\n','');
},/Incomplete/);
bad('rejects newline injection in remote key',p=>{
 p.remote=raw().replace('ROOT_OWNER=root:root','ROOT_OWNER=root:root\r');
},/Control characters/);
bad('rejects number beyond safe integer',p=>{
 p.remote=raw().replace('LIVE_INDEX_BYTES=34567',
  'LIVE_INDEX_BYTES=99999999999999999999');
},/source counts/);
bad('rejects remote output above 4KiB',p=>{
 p.remote=raw()+'X'.repeat(6000);
},/bounded remote/);
test('R132 manual CLI refuses to run from PR with no remote',()=>{
 const r=spawnSync(process.execPath,
  ['ops/r132_current_main_readonly_parity.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000,
    env:{...process.env,GITHUB_REPOSITORY:'other/repo',
      GITHUB_REF:'refs/heads/fake',GITHUB_EVENT_NAME:'pull_request'},
  });
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/R132_PRODUCTION_READONLY_REFUSED/);
 assert.doesNotMatch(r.stdout,/AUDIT=PASS/);
});
test('R132 contains only approved component labels in output',()=>{
 const p=auditCurrentSource(data());
 const serialized=JSON.stringify(p);
 assert.doesNotMatch(serialized,/token|password|private-key/);
 assert.deepEqual(COMPONENTS.slice().sort(),[
   'developer-console.js','interaction-bridge.js','marcosa-config.js',
   'marcosa-supabase.js','nexus.js','scripts','supabase',
 ]);
});
test('R132 CI contract never contacts production for a PR or ordinary push',()=>{
 const wf=readFileSync(new URL('../.github/workflows/marcosa-r100-production-readonly-compat.yml',import.meta.url),'utf8');
 const trigger=wf.split('on:\n')[1].split('permissions:\n')[0];
 assert.match(trigger,/^  pull_request:/m);
 assert.match(trigger,/^  workflow_dispatch:/m);
 assert.doesNotMatch(trigger,/^  push:/m);
 assert.doesNotMatch(trigger,/^  workflow_run:/m);
 assert.match(wf,/github.event_name == 'workflow_dispatch'/);
 assert.match(wf,/github.ref == 'refs\/heads\/main'/);
 assert.match(wf,/inputs.confirmation == 'AUDIT-PRODUCTION-READONLY'/);
 assert.match(wf,/needs: offline-contract/);
 assert.match(wf,/node --test tests\/r132_current_main_readonly_parity\.test\.mjs/);
 assert.match(wf,/node ops\/r132_current_main_readonly_parity\.mjs/);
 assert.match(wf,/sha256sum site\/index\.html/);
 assert.match(wf,/git rev-parse HEAD/);
 assert.match(wf,/StrictHostKeyChecking=yes/);
 assert.match(wf,/MARCOSA_STAGING_HOST/);
 assert.match(wf,/marcosa-r132-current-sha-readonly\.json/);
 assert.doesNotMatch(wf,/40232174313|863adfddfef56783b7bc62e99c1b466c3571f134/);
 assert.doesNotMatch(wf,/tar -xOzf marcosa-site/);
 assert.doesNotMatch(wf,/rm -rf \/opt\/marcosa|rsync --delete|systemctl restart/);
});
