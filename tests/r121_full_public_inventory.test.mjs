import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OLD_INDEX,CRITICAL,FORMAT,evaluatePublicInventory}
  from '../ops/r121_full_public_inventory.mjs';

const sha='a'.repeat(40);
function proof() {
  const names=[...CRITICAL,'index.html'].sort();
  const files=names.map(name=>({
    name,bytes:10,sha256:name==='index.html'?OLD_INDEX:'e'.repeat(64),
  }));
  const r118={
    format:'MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1',
    sourceSha:sha,
    preliminaryAudit:'PASS',productionDecision:'NO_GO',
    productionAuthorized:false,productionChanged:false,
    directRootReplacementAllowed:false,
    verifiedPreviewScope:'public_static_preview_only',
    checks:{
      r117TripleProof:'PASS',realProductionRootReadOnlyParity:'PASS',
      stageShaEqualsAuditedMain:true,
    },
    existingRoot:{
      indexSha256:OLD_INDEX,
      counts:{legacyPublicTopLevel:files.length},
      criticalPublicIntegrationNamesPresent:[...CRITICAL],
      secretServerEnvironment:'LEAK_ME_NEVER',
    },
  };
  const inventory={
    format:'MARCOSA-R121-LEGACY-PUBLIC-FILE-INVENTORY-v1',
    readOnly:true,productionAuthorized:false,publicTopLevelOnly:true,
    fileCount:files.length,totalBytes:files.length*10,indexSha256:OLD_INDEX,
    criticalPresent:[...CRITICAL].sort(),files,
    rawCustomerData:'DO_NOT_LEAK_PRIVATE_CUSTOMER',
  };
  return {expectedSha:sha,r118,inventory};
}
test('all actual public hashes collected while production cutover remains NO_GO',()=>{
  const v=evaluatePublicInventory(proof());
  assert.equal(v.format,FORMAT);
  assert.equal(v.status,'PASS');
  assert.equal(v.numberOfHashedPublicFiles,CRITICAL.length+1);
  assert.equal(v.publicFileHashes.length,v.numberOfHashedPublicFiles);
  assert.match(v.sha256OfCanonicalPublicManifest,/^[a-f0-9]{64}$/);
  assert.equal(v.completeCurrentPublicHashInventory,true);
  assert.equal(v.historicalAllFilesUnchangedVerified,false);
  assert.equal(v.mainProductionRootCutoverAuthorized,false);
  assert.equal(v.customerStorageOrAuthInspected,false);
  assert.equal(v.noProductionChangesMade,true);
  assert.equal(v.verdict,'NO_GO');
  const output=JSON.stringify(v);
  assert.equal(output.includes('LEAK_ME_NEVER'),false);
  assert.equal(output.includes('DO_NOT_LEAK_PRIVATE_CUSTOMER'),false);
});
test('old root index SHA mutation records DRIFT, never PASS',()=>{
  const x=proof();
  x.inventory.indexSha256='b'.repeat(64);
  x.inventory.files.find(f=>f.name==='index.html').sha256='b'.repeat(64);
  const result=evaluatePublicInventory(x);
  assert.equal(result.status,'DRIFT');
  assert.ok(result.driftReasons.includes('INDEX_CHANGED_SINCE_R118'));
  assert.ok(result.driftReasons.includes('INDEX_CHANGED_SINCE_PINNED_R118_BASELINE'));
});
test('a missing public file fails historical R118 count parity',()=>{
  const x=proof();
  x.inventory.files.pop();
  x.inventory.fileCount--;
  x.inventory.totalBytes-=10;
  x.inventory.criticalPresent=x.inventory.criticalPresent.filter(n=>
    x.inventory.files.some(f=>f.name===n));
  const result=evaluatePublicInventory(x);
  assert.equal(result.status,'DRIFT');
  assert.ok(result.driftReasons.includes('COUNT_CHANGED_SINCE_R118'));
});
test('missing critical public legacy file raises named drift alert',()=>{
  const x=proof();
  x.inventory.files=x.inventory.files.filter(f=>f.name!=='nexus.js');
  x.inventory.fileCount--;x.inventory.totalBytes-=10;
  x.inventory.criticalPresent=x.inventory.criticalPresent.filter(x=>x!=='nexus.js');
  const v=evaluatePublicInventory(x);
  assert.equal(v.status,'DRIFT');
  assert.ok(v.driftReasons.includes('MISSING_CRITICAL_FILE:nexus.js'));
});
test('stale actual R118 report cannot attest newly merged SHA',()=>{
  const x=proof();x.expectedSha='b'.repeat(40);
  assert.throws(()=>evaluatePublicInventory(x),/provenance/);
});
test('spoofed R118 PASS or account authorization must be blocked',()=>{
  for(const key of ['productionAuthorized','productionChanged',
    'directRootReplacementAllowed']){
    const x=proof();x.r118[key]=true;
    assert.throws(()=>evaluatePublicInventory(x),/provenance/);
  }
  const x=proof();x.r118.checks.r117TripleProof='PENDING';
  assert.throws(()=>evaluatePublicInventory(x),/provenance/);
});
test('inventory itself cannot claim production write or authorize cutover',()=>{
  const x=proof();x.inventory.productionAuthorized=true;
  assert.throws(()=>evaluatePublicInventory(x),/Untrusted read-only/);
  const y=proof();y.inventory.readOnly=false;
  assert.throws(()=>evaluatePublicInventory(y),/Untrusted read-only/);
});
test('rejects illegal, private or nested filename, duplicated public path',()=>{
  for(const bad of ['../.env','.env','secrets.json','Private Session.js','nested/file.js']){
    const x=proof();x.inventory.files[0].name=bad;
    assert.throws(()=>evaluatePublicInventory(x),/Rejected invalid public asset record/);
  }
  const d=proof();d.inventory.files[1].name=d.inventory.files[0].name;
  assert.throws(()=>evaluatePublicInventory(d),/Duplicate|deterministically/);
});
test('rejects fabricated checksums, implausible sizes or forged index',()=>{
  const a=proof();a.inventory.files[0].sha256='invalid';
  assert.throws(()=>evaluatePublicInventory(a),/Rejected invalid/);
  const b=proof();b.inventory.files[0].bytes=-1;
  assert.throws(()=>evaluatePublicInventory(b),/Rejected invalid/);
  const c=proof();c.inventory.totalBytes++;
  assert.throws(()=>evaluatePublicInventory(c),/byte totals/);
  const d=proof();d.inventory.indexSha256='b'.repeat(64);
  assert.throws(()=>evaluatePublicInventory(d),/Missing or forged/);
});
test('critical public filename list must match file reality exactly',()=>{
  const x=proof();x.inventory.criticalPresent=[];
  assert.throws(()=>evaluatePublicInventory(x),/Inconsistent critical/);
  const y=proof();y.inventory.criticalPresent=['.env'];
  assert.throws(()=>evaluatePublicInventory(y),/Unsafe critical/);
});
test('hash inventory never requires credentials, root or writes to production',()=>{
  const yaml=readFileSync(
    new URL('../.github/workflows/marcosa-r121-full-legacy-hash-inventory.yml',import.meta.url),
    'utf8');
  assert.match(yaml,/permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.match(yaml,/github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(yaml,/ref: main/);
  assert.match(yaml,/git rev-parse HEAD/);
  assert.match(yaml,/StrictHostKeyChecking=yes/);
  assert.match(yaml,/DEPLOY_USER.*MARCOSA_STAGING_USER/);
  assert.match(yaml,/load-pinned-staging-host\.sh/);
  assert.match(yaml,/gh run download/);
  assert.match(yaml,/r121_public_legacy_fingerprints\.py/);
  assert.doesNotMatch(yaml,/sudo |rsync --delete|nginx -s reload|systemctl restart|0\.0\.0\.0/);
});
