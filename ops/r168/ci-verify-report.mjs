/**
 * R168 independent source-evidence check in a SECOND GitHub Actions runner.
 * Rehashes exact source bytes and rejects unexpected booleans/fields.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildR163Bundle} from '../r163/repro-bundle.mjs';
const err=m=>{throw Error('R168 report verification: '+m);};
const ok=(v,m)=>{if(!v)err(m);};
const env=process.env;
ok(env.GITHUB_ACTIONS==='true'&&
 env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'&&
 /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&
 typeof env.RUNNER_TEMP==='string'&&
 !env.PGHOST&&!env.PGPASSWORD,
 'separate read-only non-DB runner required');
const report=JSON.parse(await readFile(join(env.RUNNER_TEMP,
 'r168-independent-report','r168-safe-provider-evidence.json'),'utf8'));
const expected=['schemaVersion','commit','bundleSha256','encryptedSha256',
 'sourceInventorySha256','objectVersion','nativePostgres17Restored',
 'sourceRlsEqualsTargetRls','signedEncryptedArchiveMetadataVerified',
 'kmsContextAndDecryptVerified','complianceLockAndPublicBlockVerifiedAgainstMock',
 'vendorSdkV3InputShapesExercised','negativeAccessDowngradeAndCryptoChecksPass',
 'realAwsAccountVerified','realExternalS3Connected','realKmsConnected',
 'independentKmsSecurityAudit','productionAuthorized'].sort().join(',');
ok(report&&Object.getPrototypeOf(report)===Object.prototype&&
 Object.keys(report).sort().join(',')===expected&&
 report.schemaVersion===1&&report.commit===env.GITHUB_SHA&&
 [report.bundleSha256,report.encryptedSha256,report.sourceInventorySha256].every(
  x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))&&
 /^[A-Za-z0-9_.-]{1,128}$/.test(report.objectVersion||''),
 'exact bounded nonsecret security evidence required');
for(const flag of [
 'nativePostgres17Restored','sourceRlsEqualsTargetRls',
 'signedEncryptedArchiveMetadataVerified','kmsContextAndDecryptVerified',
 'complianceLockAndPublicBlockVerifiedAgainstMock',
 'vendorSdkV3InputShapesExercised','negativeAccessDowngradeAndCryptoChecksPass'
])ok(report[flag]===true,'CI contract missing verified '+flag);
for(const flag of ['realAwsAccountVerified','realExternalS3Connected',
 'realKmsConnected','independentKmsSecurityAudit','productionAuthorized'])
 ok(report[flag]===false,'unsafe claim about live cloud: '+flag);
const local=await buildR163Bundle({root:process.cwd(),commit:env.GITHUB_SHA});
ok(report.bundleSha256===local.sha256,
 'independent source runner source bundle sha changed');
console.log('R168_SECOND_RUNNER_SOURCE_REPORT_REHASH_VERIFIED=PASS');
console.log('R168_PROVIDER_SDK_CONTRACT_AND_PG17_SAFE_FLAGS=PASS');
console.log('R168_NO_AWS_ACCOUNTS_CUSTOMER_DATA_OR_PRODUCTION=PASS');
