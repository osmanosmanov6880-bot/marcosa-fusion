/**
 * Second independent GitHub Actions job: re-materialize the exact source
 * package from a fresh checkout and compare uploaded artifact bytes.
 * This is cross-runner replay verification, NOT human reviewer approval.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {verifyR163Bundle} from './repro-bundle.mjs';
const repo='osmanosmanov6880-bot/marcosa-fusion';
const assert=(v,m)=>{if(!v)throw Error('R163 second runner: '+m);};
assert(process.env.GITHUB_ACTIONS==='true'&&
 process.env.GITHUB_REPOSITORY===repo&&
 /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||'')&&
 typeof process.env.R163_ARTIFACT_DIR==='string'&&
 typeof process.env.RUNNER_TEMP==='string'&&
 resolve(process.env.R163_ARTIFACT_DIR)===
  resolve(process.env.RUNNER_TEMP,'r163-downloaded'),
 'trusted runner and explicit downloaded artifact root required');
const dir=process.env.R163_ARTIFACT_DIR,commit=process.env.GITHUB_SHA;
const [bytes,reportBytes,manifestBytes]=await Promise.all([
 readFile(join(dir,'source.bundle.json')),
 readFile(join(dir,'ci-report.json')),
 readFile(join(dir,'manifest.json'))
]);
let report,manifest;
try{report=JSON.parse(reportBytes.toString());manifest=JSON.parse(manifestBytes.toString());}
catch{throw Error('R163 second runner: invalid artifact JSON');}
const hash=b=>createHash('sha256').update(b).digest('hex');
const compare=(a,b)=>typeof a==='string'&&typeof b==='string'&&
 /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&
 timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
assert(Object.keys(manifest).sort().join(',')===
 'bundleSha256,commit,productionAuthorized,reportSha256,repository,schemaVersion'&&
 manifest.schemaVersion===1&&manifest.repository===repo&&
 manifest.commit===commit&&manifest.productionAuthorized===false&&
 compare(manifest.bundleSha256,hash(bytes))&&
 compare(manifest.reportSha256,hash(reportBytes)),
 'artifact integrity manifest mismatched');
assert(report.schemaVersion===1&&report.repository===repo&&
 report.commit===commit&&report.decision==='CI_SIMULATION_COMPLETE'&&
 report.productionAuthorized===false&&report.realSupabaseUsed===false&&
 report.independentlyReviewed===false&&report.syntheticCiLoopback===true&&
 report.syntheticRestoreProof===true&&
 compare(report.bundleSha256,manifest.bundleSha256),
 'CI-only proof cannot assert commercial readiness');
const proof=await verifyR163Bundle({root:process.cwd(),commit,bytes,
 expectedSha256:manifest.bundleSha256});
assert(proof.exactSourceBytes&&proof.sourceCount===report.sourceCount&&
 proof.productionAuthorized===false,
 'fresh runner source checkout differs from uploaded package');
console.log('R163_FRESH_RUNNER_SOURCE_REBUILD_MATCHED=PASS');
console.log('R163_CHECKOUT_SHA='+commit);
console.log('R163_BUNDLE_SHA256='+manifest.bundleSha256);
console.log('R163_NO_EXTERNAL_REVIEW_OR_PRODUCTION_RELEASE=NO_GO');
