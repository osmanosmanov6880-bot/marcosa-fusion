#!/usr/bin/env node
/**
 * R118: inspect the REAL existing MARCOSA root versus an isolated, already
 * triple-proved preview.  A passed AUDIT is emphatically NOT a production GO.
 * Input: bounded R101 stdout and R117 trusted GitHub release certificate.
 * Never reads production HTML, secrets, user data, DB or server configuration.
 */
import {readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO = 'osmanosmanov6880-bot/marcosa-fusion';
export const FORMAT = 'MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const CRITICAL = Object.freeze([
  'marcosa-config.js', 'marcosa-supabase.js', 'interaction-bridge.js',
  'developer-console.js', 'nexus.js',
]);
const RISK_FLAGS = new Set([
  'LIVE_AND_PREVIEW_INDEX_DIFFER',
  'EXISTING_INTEGRATIONS_NOT_IN_STATIC_PREVIEW',
  'LEGACY_ASSETS_WOULD_BE_REMOVED_BY_ROOT_REPLACEMENT',
  'LEGACY_INDEX_REFERENCES_ABSENT_FILES',
  'PREVIEW_INDEX_REFERENCES_ABSENT_FILES',
  'STATIC_PREVIEW_NOT_PROVEN_AUTHENTICATED_PRODUCTION',
]);
const need = (condition, message) => {if (!condition) throw Error(message);};
function boundedInteger(value, name, upper=100000) {
  need(Number.isSafeInteger(value) && value >= 0 && value <= upper,
    'Invalid bounded ' + name);
  return value;
}
function safeCritical(array, name) {
  need(Array.isArray(array) && array.length <= CRITICAL.length,
    'Invalid critical list: ' + name);
  need(array.every(x => typeof x === 'string' && CRITICAL.includes(x)),
    'Unapproved integration name in ' + name);
  need(new Set(array).size === array.length, 'Duplicate critical integrations');
  return array.slice().sort();
}
function safeFlags(flags) {
  need(Array.isArray(flags) && flags.length <= RISK_FLAGS.size,
    'Unexpected number of risk flags');
  need(flags.every(x => typeof x === 'string' && RISK_FLAGS.has(x)),
    'Unknown risk flag in legacy audit');
  need(new Set(flags).size === flags.length, 'Duplicate risk flags');
  return flags.slice().sort();
}

export function evaluateProductionBoundary({releaseCertificate, liveAudit, expectedSha}={}) {
  need(typeof expectedSha === 'string' && SHA40.test(expectedSha),
    'Exact 40-byte source SHA required');
  need(releaseCertificate && typeof releaseCertificate === 'object' &&
    !Array.isArray(releaseCertificate), 'Missing trusted R117 certificate');
  need(releaseCertificate.format === 'MARCOSA-R117-TRIPLE-PROOF-PREVIEW-CERTIFICATE-v1' &&
    releaseCertificate.status === 'PASS' &&
    releaseCertificate.sourceSha === expectedSha &&
    releaseCertificate.mainSha === expectedSha,
    'R117 triple-proof cannot attest current exact SHA');
  need(releaseCertificate.scope === 'public_static_preview_only' &&
    releaseCertificate.productionAuthorized === false &&
    releaseCertificate.productionCutoverVerified === false &&
    releaseCertificate.databaseBackupOrRestoreVerified === false &&
    releaseCertificate.privateAuthOrAccountMigrationVerified === false,
    'R117 release scope is inconsistent');
  const channels=releaseCertificate.evidence || {};
  for (const name of ['publicPages','restrictedContaboStaging','verifiedVpsRollbackCandidate'])
    need(channels[name]?.status === 'PASS', 'Missing PASS in R117 channel: ' + name);

  need(liveAudit && typeof liveAudit === 'object' && !Array.isArray(liveAudit) &&
    liveAudit.format === 'MARCOSA-PRODUCTION-PARITY-R101' &&
    liveAudit.auditReadOnly === true &&
    liveAudit.productionAuthorized === false &&
    liveAudit.directRootReplacementAllowed === false &&
    liveAudit.stagingSourceSha === expectedSha,
    'Live R101 parity report is not trusted for this exact staging SHA');
  need(SHA64.test(liveAudit.liveIndexSha256 || '') &&
    SHA64.test(liveAudit.stagingIndexSha256 || '') &&
    typeof liveAudit.indexBytesIdentical === 'boolean',
    'Missing genuine production/staging index checksums');
  const present = safeCritical(liveAudit.criticalLegacyIntegrationFiles,
    'criticalLegacyIntegrationFiles');
  const missing = safeCritical(liveAudit.criticalMissingFromStaticPreview,
    'criticalMissingFromStaticPreview');
  need(missing.every(name => present.includes(name)), 'Missing list is not a subset of present');
  const flags=safeFlags(liveAudit.riskFlags);
  const counts={
    legacyPublicTopLevel:boundedInteger(liveAudit.legacyPublicTopLevelCount,'legacy count'),
    stagingManifest:boundedInteger(liveAudit.stagingManifestCount,'manifest count',5000),
    legacyOnlyTopLevel:boundedInteger(liveAudit.legacyOnlyTopLevelCount,'legacy-only count'),
    previewOnlyTopLevel:boundedInteger(liveAudit.previewOnlyTopLevelCount,'preview-only count'),
    missingLegacyLocalReferences:boundedInteger(liveAudit.legacyBrokenLocalReferencesCount,'legacy refs'),
    missingPreviewLocalReferences:boundedInteger(liveAudit.previewBrokenLocalReferencesCount,'preview refs'),
  };
  need(counts.stagingManifest >= 3 &&
    counts.legacyOnlyTopLevel <= counts.legacyPublicTopLevel,
    'Implausible comparison counts');
  if (liveAudit.indexBytesIdentical)
    need(liveAudit.liveIndexSha256 === liveAudit.stagingIndexSha256,
      'Identical pages cannot have different SHA256');
  else
    need(liveAudit.liveIndexSha256 !== liveAudit.stagingIndexSha256,
      'Different pages cannot share SHA256');
  // Fail closed on structural inconsistencies before publishing a report.
  if (missing.length)
    need(flags.includes('EXISTING_INTEGRATIONS_NOT_IN_STATIC_PREVIEW'),
      'Critical legacy mismatch omitted from risk flags');
  if (counts.legacyOnlyTopLevel)
    need(flags.includes('LEGACY_ASSETS_WOULD_BE_REMOVED_BY_ROOT_REPLACEMENT'),
      'Legacy asset loss missing from risk flags');

  const blockers=[
    'PRODUCTION_AUTH_AND_RLS_NOT_INDEPENDENTLY_VERIFIED',
    'POSTGRES_AND_PRIVATE_STORAGE_RESTORE_NOT_INDEPENDENTLY_VERIFIED',
    'LEGACY_RUNTIME_AND_API_COMPATIBILITY_NOT_PROVEN',
    'PUBLIC_HTTPS_STAGING_ISOLATION_NOT_VERIFIED',
    'PRODUCTION_CHANGE_APPROVAL_AND_ROLLBACK_NOT_VERIFIED',
    'REAL_BETA_LEGAL_PAYMENTS_AND_MODERATION_GATE_NOT_VERIFIED',
  ];
  if (missing.length) blockers.push('CRITICAL_LEGACY_INTEGRATIONS_ABSENT_IN_PREVIEW');
  if (!liveAudit.indexBytesIdentical) blockers.push('PRODUCTION_AND_PREVIEW_INDEX_DIFFER');
  if (counts.legacyOnlyTopLevel) blockers.push('LEGACY_PUBLIC_ASSETS_NOT_IN_PREVIEW');
  if (counts.missingLegacyLocalReferences || counts.missingPreviewLocalReferences)
    blockers.push('PUBLIC_LOCAL_ASSET_REFERENCES_NEED_REPAIR');

  // Deliberately DO NOT spread the remote object into the report. It is
  // untrusted, can contain private HTML or paths, and is never uploaded.
  return {
    format:FORMAT,
    sourceSha:expectedSha,
    verifiedPreviewScope:'public_static_preview_only',
    preliminaryAudit:'PASS',
    productionDecision:'NO_GO',
    directRootReplacementAllowed:false,
    productionAuthorized:false,
    productionChanged:false,
    accountsMigratedOrVerified:false,
    databasesBackedUpAndRestored:false,
    signedBusinessAndLegalApprovalVerified:false,
    checks:{
      r117TripleProof:'PASS',
      realProductionRootReadOnlyParity:'PASS',
      stageShaEqualsAuditedMain:true,
    },
    existingRoot:{
      indexSha256:liveAudit.liveIndexSha256,
      criticalPublicIntegrationNamesPresent:present,
      criticalPublicIntegrationNamesAbsentInPreview:missing,
      counts,
    },
    isolatedStage:{indexSha256:liveAudit.stagingIndexSha256},
    byteIdenticalIndex:liveAudit.indexBytesIdentical,
    verifiedRiskFlags:flags,
    noGoReasons:blockers,
    note:'Read-only public-file comparison only. Never an authorization to overwrite marcosa.club, databases, identities or other applications.',
  };
}
function readJson(path, cap) {
  const bytes=readFileSync(path);
  need(bytes.length > 2 && bytes.length <= cap, 'Input JSON missing or oversized');
  return JSON.parse(bytes.toString('utf8'));
}
function main() {
  need(process.env.GITHUB_REPOSITORY === REPO, 'Wrong repository');
  const expectedSha=process.env.RELEASE_SHA;
  need(SHA40.test(expectedSha || ''), 'Expected full Git commit SHA required');
  const report=evaluateProductionBoundary({
    releaseCertificate:readJson('marcosa-r117-release-certificate.json', 256*1024),
    liveAudit:readJson('r118-legacy-parity-untrusted.json', 64*1024),
    expectedSha,
  });
  writeFileSync('marcosa-r118-production-boundary.json',
    JSON.stringify(report,null,2) + '\n',{flag:'wx', mode:0o600});
  console.log('R118_REAL_PRODUCTION_PARITY_AUDIT=PASS');
  console.log('R118_PRODUCTION_DECISION=NO_GO');
  console.log('R118_DIRECT_ROOT_REPLACEMENT_ALLOWED=NO');
  console.log('R118_PUBLIC_ASSETS_LEGACY_ONLY=' + report.existingRoot.counts.legacyOnlyTopLevel);
  console.log('R118_CRITICAL_LEGACY_MISSING_FROM_PREVIEW=' +
    report.existingRoot.criticalPublicIntegrationNamesAbsentInPreview.length);
  console.log('R118_RELEASE_SHA=' + report.sourceSha);
  if(process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### MARCOSA R118 — actual production root vs isolated triple-proved STAGING',
      '- Reviewed commit: ' + report.sourceSha,
      '- Preview certificate: **PASS**; actual read-only production comparison: **PASS**',
      '- Legacy-only public top-level files: ' + report.existingRoot.counts.legacyOnlyTopLevel,
      '- Critical integrations missing in static preview: ' +
        report.existingRoot.criticalPublicIntegrationNamesAbsentInPreview.join(', '),
      '- Actual root replacement decision: **NO_GO**',
      '- No user files, secrets, auth configuration, root contents or database copied.',
      '- No production, DNS, Nginx or user-data changes made.',
      '',
    ].join('\n'));
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {main();}
  catch(error) {
    console.error('R118_AUDIT_REFUSED=' + String(error.message||error).slice(0,160));
    process.exitCode=2;
  }
}
