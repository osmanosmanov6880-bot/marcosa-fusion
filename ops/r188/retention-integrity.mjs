/**
 * R188 independent read-only retention verification across native disposable
 * PostgreSQL17 primary and restored databases.
 * Checks all 8 surviving deterministic rows, absence of 4 expired rows,
 * their R187 receipt SHA, strict FORCE RLS, closed native quarantine.
 * No additional deletes and no live customer data.
 */
import {createHash} from 'node:crypto';
import {r187SyntheticRetentionRows} from '../r187/privacy-retention.mjs';
const fail=m=>{throw Error('R188 retention integrity: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/;
const fields=['runId','sequence','nonce','sourceCommit',
 'r187EvidenceSha256','decision','productionAuthorized'];
const receipt=x=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',')&&
 Number.isSafeInteger(x.runId)&&x.runId>=10000&&
 Number.isSafeInteger(x.sequence)&&x.sequence>=2&&x.sequence<=32&&
 /^[a-f0-9]{32}$/.test(x.nonce||'')&&
 H40.test(x.sourceCommit||'')&&H64.test(x.r187EvidenceSha256||'')&&
 x.decision==='NO_GO_REAL_STAGING_ATTESTATION_PENDING'&&
 x.productionAuthorized===false;
function exactRows(actual,expected){
 return Array.isArray(actual)&&actual.length===expected.length&&
  actual.every((row,i)=>row&&Object.getPrototypeOf(row)===Object.prototype&&
   Object.keys(row).sort().join(',')==='expired,kind,ordinal,sha256'&&
   row.ordinal===expected[i].ordinal&&
   row.kind===expected[i].kind&&row.sha256===expected[i].sha256&&
   row.expired===false);
}
export function createR188RetentionIntegrity({
 readR187Hold,readRows,readRlsState,readQuarantine,
 clock=()=>Date.now(),allowInspect=false
}={}){
 ok([readR187Hold,readRows,readRlsState,readQuarantine,clock]
  .every(x=>typeof x==='function'),
  'two native PG17 readbacks, immutable witness and quarantine required');
 async function inspect({commit,bundleSha256,runId,r187Proof,
  primary='postgres',restored='marcosa_r187_restored'}={}){
  ok(allowInspect===true&&H40.test(commit||'')&&
   H64.test(bundleSha256||'')&&Number.isSafeInteger(runId)&&
   runId>=10000&&primary==='postgres'&&
   restored==='marcosa_r187_restored',
   'read-only disposable source and restored database names required');
  const p=r187Proof;
  ok(p&&Object.getPrototypeOf(p)===Object.prototype&&
   p.scope==='disposable-pg17-synthetic-retention-only'&&
   p.sourceCommit===commit&&p.sourceBundleSha256===bundleSha256&&
   p.runId===runId&&p.syntheticRowsBefore===12&&
   p.syntheticExpiredRowsDeleted===4&&
   p.syntheticActiveRowsRemaining===8&&
   p.rawCustomerDataProcessed===false&&
   p.liveRetentionPolicyEnforced===false&&
   p.realPrivacyComplianceAttested===false&&
   p.productionAuthorized===false,
   'R187 only synthetic receipt required');
  const {evidenceSha256,...proof}=p;
  ok(H64.test(evidenceSha256||'')&&evidenceSha256===hash(proof),
   'R187 retention receipt hash mismatched');
  const expected=r187SyntheticRetentionRows({commit,runId});
  ok(p.beforeRowsSha256===hash(expected)&&
   p.afterRowsSha256===hash(expected.slice(4)),
   'R187 receipt does not commit to the exact synthetic contents');
  const [sourceWitness,sourceRows,copyRows,sourceRls,copyRls,
   quarantine]=await Promise.all([
    readR187Hold(primary),readRows(primary),readRows(restored),
    readRlsState(primary),readRlsState(restored),
    readQuarantine()
   ]);
  ok(receipt(sourceWitness)&&sourceWitness.runId===runId&&
   sourceWitness.sourceCommit===commit&&
   exactRows(sourceRows,expected.slice(4))&&
   exactRows(copyRows,expected.slice(4))&&
   sourceRls?.forced===true&&copyRls?.forced===true&&
   sourceRls.publicSelect===false&&copyRls.publicSelect===false&&
   quarantine?.closed===true&&
   Number.isSafeInteger(quarantine.generation)&&
   quarantine.generation>=5,
   'source, restored row payload, RLS or closed quarantine mismatch');
  const [witnessAgain,qAgain]=await Promise.all([
   readR187Hold(primary),readQuarantine()
  ]);
  ok(receipt(witnessAgain)&&fields.every(k=>witnessAgain[k]===sourceWitness[k])&&
   qAgain?.closed===true&&qAgain.generation===quarantine.generation,
   'source witness or quarantine drifted during dual-store readback');
  const time=clock();
  ok(Number.isSafeInteger(time)&&time>0,
   'valid independent timestamp required');
  const out={
   schemaVersion:1,scope:'read-only-two-native-pg17-retention-readbacks',
   sourceCommit:commit,sourceBundleSha256:bundleSha256,
   runId,r187EvidenceSha256:sourceWitness.r187EvidenceSha256,
   retentionReceiptSha256:p.evidenceSha256,
   sourceRows:8,restoredRows:8,expiredRowsMissing:4,
   observedRowSetSha256:hash(sourceRows),
   nativeForceRlsOnBothCopies:true,
   publicSelectDeniedOnBothCopies:true,
   quarantineRemainsClosed:true,
   liveCustomerRecordsRead:false,
   realRetentionComplianceVerified:false,
   realPilotAuthorized:false,productionAuthorized:false,
   observedAtMs:time,decision:'NO_GO_READONLY_SYNTHETIC_RETENTION'
  };
  return Object.freeze({...out,evidenceSha256:hash(out)});
 }
 return Object.freeze({inspect,publicStatus:()=>({
  readOnly:true,enabled:allowInspect,
  realPilotAuthorized:false,productionAuthorized:false})});
}
