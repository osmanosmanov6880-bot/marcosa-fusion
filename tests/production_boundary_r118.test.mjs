import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateProductionBoundary, FORMAT} from '../ops/production_boundary_r118.mjs';

const sha='a'.repeat(40), prior='b'.repeat(40),hash='c'.repeat(64),oldHash='d'.repeat(64);
function fixture() {
  return {
    expectedSha:sha,
    releaseCertificate:{
      format:'MARCOSA-R117-TRIPLE-PROOF-PREVIEW-CERTIFICATE-v1',
      status:'PASS',sourceSha:sha,mainSha:sha,
      scope:'public_static_preview_only',
      productionAuthorized:false,productionCutoverVerified:false,
      databaseBackupOrRestoreVerified:false,
      privateAuthOrAccountMigrationVerified:false,
      evidence:{
        publicPages:{status:'PASS'},restrictedContaboStaging:{status:'PASS'},
        verifiedVpsRollbackCandidate:{status:'PASS'},
      },
    },
    liveAudit:{
      format:'MARCOSA-PRODUCTION-PARITY-R101',
      auditReadOnly:true,productionAuthorized:false,
      directRootReplacementAllowed:false,stagingSourceSha:sha,
      liveIndexSha256:hash,stagingIndexSha256:oldHash,indexBytesIdentical:false,
      criticalLegacyIntegrationFiles:['nexus.js','marcosa-config.js','marcosa-supabase.js'],
      criticalMissingFromStaticPreview:['nexus.js','marcosa-config.js'],
      legacyPublicTopLevelCount:15,stagingManifestCount:63,
      legacyOnlyTopLevelCount:8,previewOnlyTopLevelCount:48,
      legacyBrokenLocalReferencesCount:0,previewBrokenLocalReferencesCount:0,
      riskFlags:[
        'LIVE_AND_PREVIEW_INDEX_DIFFER',
        'EXISTING_INTEGRATIONS_NOT_IN_STATIC_PREVIEW',
        'LEGACY_ASSETS_WOULD_BE_REMOVED_BY_ROOT_REPLACEMENT',
        'STATIC_PREVIEW_NOT_PROVEN_AUTHENTICATED_PRODUCTION',
      ],
      legacyOnlyExample:['some-hidden-secret.json'],
    },
  };
}
const exec=f=>evaluateProductionBoundary(f);
test('real parity + independently triple-proved preview yields audited NO_GO, never production GO',()=>{
  const r=exec(fixture());
  assert.equal(r.format,FORMAT);
  assert.equal(r.preliminaryAudit,'PASS');
  assert.equal(r.productionDecision,'NO_GO');
  assert.equal(r.directRootReplacementAllowed,false);
  assert.equal(r.productionAuthorized,false);
  assert.equal(r.productionChanged,false);
  assert.equal(r.accountsMigratedOrVerified,false);
  assert.equal(r.databasesBackedUpAndRestored,false);
  assert.equal(r.sourceSha,sha);
  assert.equal(r.existingRoot.counts.legacyOnlyTopLevel,8);
  assert.deepEqual(r.existingRoot.criticalPublicIntegrationNamesAbsentInPreview,
    ['marcosa-config.js','nexus.js']);
  assert.ok(r.noGoReasons.includes('CRITICAL_LEGACY_INTEGRATIONS_ABSENT_IN_PREVIEW'));
});
test('report is scrubbed; ignore unexpected malicious and secret fields from remote JSON',()=>{
  const x=fixture();
  x.liveAudit.runtimeEnvironment='PRIVATE_TOKEN_123';
  x.liveAudit.legacyOnlyExample=['PRIVATE_CUSTOMER_LIST_123'];
  x.liveAudit.rawHtml='<script>PRIVATE_ROOT_HTML_123</script>';
  const r=JSON.stringify(exec(x));
  for(const secret of ['PRIVATE_TOKEN_123','PRIVATE_CUSTOMER_LIST_123','PRIVATE_ROOT_HTML_123'])
    assert.equal(r.includes(secret),false);
});
test('R117 PASS cannot be reused against a different main commit',()=>{
  const x=fixture();x.expectedSha=prior;assert.throws(()=>exec(x),/R117 triple-proof/);
});
test('R117 same source but stale main cannot be trusted',()=>{
  const x=fixture();x.releaseCertificate.mainSha=prior;
  assert.throws(()=>exec(x),/R117 triple-proof/);
});
test('uncompleted R117 or failed one of three channels refuse audit',()=>{
  for(const mode of ['PENDING','FAIL','SUPERSEDED']){
    const x=fixture();x.releaseCertificate.status=mode;
    assert.throws(()=>exec(x),/R117 triple-proof/);
  }
  for(const key of ['publicPages','restrictedContaboStaging','verifiedVpsRollbackCandidate']){
    const x=fixture();x.releaseCertificate.evidence[key].status='skipped';
    assert.throws(()=>exec(x),/Missing PASS/);
  }
});
test('malicious R117 production authorization is rejected',()=>{
  const x=fixture();x.releaseCertificate.productionAuthorized=true;
  assert.throws(()=>exec(x),/scope/);
});
test('R101 must be the exact current STAGING commit, not earlier release',()=>{
  const x=fixture();x.liveAudit.stagingSourceSha=prior;
  assert.throws(()=>exec(x),/not trusted/);
});
test('R101 must expressly forbid direct replacement and attest read-only',()=>{
  const x=fixture();x.liveAudit.auditReadOnly=false;
  assert.throws(()=>exec(x),/not trusted/);
  const y=fixture();y.liveAudit.directRootReplacementAllowed=true;
  assert.throws(()=>exec(y),/not trusted/);
  const z=fixture();z.liveAudit.productionAuthorized=true;
  assert.throws(()=>exec(z),/not trusted/);
});
test('hashes from the real legacy production and stage must be actual digest strings',()=>{
  for(const field of ['liveIndexSha256','stagingIndexSha256']){
    const x=fixture();x.liveAudit[field]='stale';
    assert.throws(()=>exec(x),/checksums/);
  }
});
test('even byte-identical indexes do not authorize production replacement',()=>{
  const x=fixture();x.liveAudit.indexBytesIdentical=true;
  x.liveAudit.stagingIndexSha256=hash;
  x.liveAudit.riskFlags=x.liveAudit.riskFlags.filter(s=>s!=='LIVE_AND_PREVIEW_INDEX_DIFFER');
  const r=exec(x);
  assert.equal(r.byteIdenticalIndex,true);
  assert.equal(r.productionDecision,'NO_GO');
});
test('claiming identical bytes with different hashes is rejected',()=>{
  const x=fixture();x.liveAudit.indexBytesIdentical=true;
  assert.throws(()=>exec(x),/Identical pages/);
});
test('invalid or unexplained critical integration filename is rejected',()=>{
  const x=fixture();x.liveAudit.criticalLegacyIntegrationFiles=['.env'];
  assert.throws(()=>exec(x),/Unapproved integration/);
});
test('missing legacy critical set must be a subset of present',()=>{
  const x=fixture();x.liveAudit.criticalMissingFromStaticPreview=['developer-console.js'];
  assert.throws(()=>exec(x),/subset/);
});
test('negative/excessive counts and impossible overlaps cannot be trusted',()=>{
  const x=fixture();x.liveAudit.legacyOnlyTopLevelCount=999999;
  assert.throws(()=>exec(x),/bounded/);
  const y=fixture();y.liveAudit.legacyOnlyTopLevelCount=99;
  assert.throws(()=>exec(y),/Implausible/);
});
test('risk flags have strict allowlist; reporting nonsense or missing mismatch fails',()=>{
  const x=fixture();x.liveAudit.riskFlags.push('RLS_IS_SAFE_TRUST_ME');
  assert.throws(()=>exec(x),/risk flag/i);
  const y=fixture();y.liveAudit.riskFlags=
    y.liveAudit.riskFlags.filter(s=>s!=='EXISTING_INTEGRATIONS_NOT_IN_STATIC_PREVIEW');
  assert.throws(()=>exec(y),/Critical legacy mismatch/);
});
test('missing sensitive reference field cannot be treated as a zero or pass',()=>{
  const x=fixture();delete x.liveAudit.legacyBrokenLocalReferencesCount;
  assert.throws(()=>exec(x),/Invalid bounded/);
});
test('real-world checks in workflow cannot change production or use broad GitHub write token',()=>{
  const file=readFileSync(new URL('../.github/workflows/marcosa-r118-production-boundary.yml',import.meta.url),'utf8');
  assert.match(file,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.match(file,/DEPLOY_USER.*secrets.MARCOSA_STAGING_USER/);
  assert.match(file,/EXPECTED_DEPLOY_KEY_FP/);
  assert.match(file,/StrictHostKeyChecking=yes/);
  assert.match(file,/ref: main/);
  assert.match(file,/persist-credentials: false/);
  assert.match(file,/tools\/production_parity_audit.py/);
  assert.match(file,/environment: marcosa-staging/);
  assert.doesNotMatch(file,/sudo\s|systemctl restart|nginx -s reload|git push|rsync --delete/);
});
