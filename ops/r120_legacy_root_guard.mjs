#!/usr/bin/env node
/**
 * MARCOSA R120: fail-closed legacy PUBLIC fingerprint drift detector.
 *
 * The trusted R118 report is produced by a READ-ONLY VPS audit and a
 * successfully triple-proved preview release. This code NEVER reads private
 * production files, authenticates users, opens SSH, or edits production.
 *
 * Scope is deliberately LIMITED: the root public index SHA-256, top-level
 * public file counts and existence of five known public integration filenames.
 * It is NOT full binary integrity or authorization to replace marcosa.club.
 */
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FORMAT='MARCOSA-R120-LEGACY-PUBLIC-FINGERPRINT-GUARD-v1';
export const BASELINE=Object.freeze({
  verifiedAtR118Commit:'5a5111d01bfb55509ea634509c1170997a16a329',
  evidenceWorkflowRun:40244992341,
  productionIndexSha256:'33d79f35b6d4873113cab99575606e5700802c0d0720eefd4604d49fe08aa9b3',
  legacyTopLevelCount:34,
  criticalPublicFiles:Object.freeze([
    'developer-console.js','interaction-bridge.js','marcosa-config.js',
    'marcosa-supabase.js','nexus.js',
  ]),
});
const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const demand=(condition,why)=>{if(!condition)throw Error(why);};
const sortedUnique=(v,max)=>{
  demand(Array.isArray(v)&&v.length<=max,'Invalid bounded file list');
  demand(v.every(x=>typeof x==='string'&&/^[a-z0-9._-]{1,80}$/.test(x)),
    'Unsafe or non-public filename');
  demand(new Set(v).size===v.length,'Duplicate public filename');
  return [...v].sort();
};
function boundedCount(v){
  demand(Number.isSafeInteger(v)&&v>=0&&v<100000,'Invalid public asset count');
  return v;
}

export function evaluateLegacyFingerprint({evidence,expectedSha}={}){
  demand(SHA40.test(expectedSha||''),'Exact current main SHA required');
  demand(evidence&&typeof evidence==='object'&&!Array.isArray(evidence),
    'Missing R118 proof object');
  demand(evidence.format==='MARCOSA-R118-LIVE-PRODUCTION-BOUNDARY-v1' &&
    evidence.sourceSha===expectedSha &&
    evidence.preliminaryAudit==='PASS' &&
    evidence.verifiedPreviewScope==='public_static_preview_only' &&
    evidence.productionDecision==='NO_GO' &&
    evidence.directRootReplacementAllowed===false &&
    evidence.productionAuthorized===false &&
    evidence.productionChanged===false &&
    evidence.accountsMigratedOrVerified===false &&
    evidence.databasesBackedUpAndRestored===false &&
    evidence.checks?.r117TripleProof==='PASS' &&
    evidence.checks?.realProductionRootReadOnlyParity==='PASS' &&
    evidence.checks?.stageShaEqualsAuditedMain===true,
    'Untrusted, stale or production-authorizing R118 report');
  const root=evidence.existingRoot;
  demand(root&&typeof root==='object'&&SHA256.test(root.indexSha256||''),
    'Missing production public index digest');
  demand(evidence.isolatedStage&&SHA256.test(evidence.isolatedStage.indexSha256||''),
    'Missing isolated staging index digest');
  const present=sortedUnique(root.criticalPublicIntegrationNamesPresent,5);
  const absentInPreview=sortedUnique(root.criticalPublicIntegrationNamesAbsentInPreview,5);
  demand(present.every(x=>BASELINE.criticalPublicFiles.includes(x)) &&
    absentInPreview.every(x=>present.includes(x)),
    'Unexpected or inconsistent critical integration list');
  const counts=root.counts;
  demand(counts&&typeof counts==='object','Missing legacy/staging counts');
  const seenCount=boundedCount(counts.legacyPublicTopLevel);
  const legacyOnly=boundedCount(counts.legacyOnlyTopLevel);
  const manifest=boundedCount(counts.stagingManifest);
  demand(manifest>0&&legacyOnly<=seenCount,'Impossible asset counts');
  const reasons=[];
  if(root.indexSha256!==BASELINE.productionIndexSha256)
    reasons.push('PRODUCTION_PUBLIC_INDEX_DIGEST_CHANGED');
  if(seenCount!==BASELINE.legacyTopLevelCount)
    reasons.push('PRODUCTION_PUBLIC_TOP_LEVEL_COUNT_CHANGED');
  for(const required of BASELINE.criticalPublicFiles)
    if(!present.includes(required))
      reasons.push('CRITICAL_LEGACY_INTEGRATION_MISSING:'+required);
  // A new approved preview can add files without changing legacy production.
  const status=reasons.length?'DRIFT':'PASS';
  return {
    format:FORMAT,
    sourceSha:expectedSha,
    baselineSourceSha:BASELINE.verifiedAtR118Commit,
    baselineEvidenceRun:BASELINE.evidenceWorkflowRun,
    status,
    scope:'public_index_digest_file_count_and_five_known_filenames_only',
    actualProductionPublicIndexSha256:root.indexSha256,
    expectedProductionPublicIndexSha256:BASELINE.productionIndexSha256,
    currentLegacyPublicTopLevelCount:seenCount,
    expectedLegacyPublicTopLevelCount:BASELINE.legacyTopLevelCount,
    observedCriticalPublicFiles:present,
    criticalMissingFromStaticPreview:absentInPreview,
    changedFields:reasons,
    productionFullyByteVerified:false,
    productionAuthenticatedAppCompatibilityVerified:false,
    databaseOrUserMigrationVerified:false,
    legacyPublicRootReplacementAllowed:false,
    productionCutoverAuthorized:false,
    productionModified:false,
    verdict:'NO_GO',
    note:'A PASS only proves the limited R118 public fingerprint baseline did not drift. No production root switch, authenticated app migration, or database recovery is allowed.',
  };
}
function main(){
  demand(process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion',
    'Wrong repository');
  const sha=process.env.RELEASE_SHA;
  demand(SHA40.test(sha||''),'Missing exact full source SHA');
  demand(process.argv.length===3&&
    process.argv[2]==='r118-evidence/marcosa-r118-production-boundary.json',
    'Only reviewed fixed artifact location is accepted');
  const bytes=readFileSync(process.argv[2]);
  demand(bytes.length>5&&bytes.length<=65536,'Evidence missing or oversized');
  const report=evaluateLegacyFingerprint({
    expectedSha:sha,
    evidence:JSON.parse(bytes.toString('utf8')),
  });
  writeFileSync('marcosa-r120-legacy-fingerprint.json',
    JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('R120_LEGACY_PUBLIC_FINGERPRINT='+report.status);
  console.log('R120_PRODUCTION_VERDICT=NO_GO');
  console.log('R120_PRODUCTION_CHANGED=NO');
  console.log('R120_COMMIT_SHA='+report.sourceSha);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
    '### MARCOSA R120 — limited legacy production fingerprint',
    '- Current exact commit: '+report.sourceSha,
    '- Public production baseline fingerprint: **'+report.status+'**',
    '- Critical files still in existing legacy root: '+report.observedCriticalPublicFiles.length+'/5',
    '- Detected drift: '+(report.changedFields.join(', ')||'none'),
    '- This is NOT a full production integrity scan.',
    '- Production root cutover and real user-data migration: **NO_GO**.',
    '',
  ].join('\n'));
  if(report.status!=='PASS')process.exitCode=3;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(e){console.error('R120_REFUSED='+String(e.message||e).slice(0,160));process.exitCode=2;}
}
